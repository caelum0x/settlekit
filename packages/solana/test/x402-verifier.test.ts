import { describe, expect, it } from "vitest";
import { X402_SCHEME, type PaymentProof } from "@settlekit/x402";
import { createSolanaPaymentVerifier, type SolanaPaymentRequirements } from "../src/x402-verifier.js";
import { BUYER, MERCHANT, PAYMENT_SIG, REFERENCE, USDC, fakeRpc, transferTx } from "./fixtures.js";

const PROOF: PaymentProof = { txHash: PAYMENT_SIG, from: BUYER, amount: "1", network: "solana", nonce: "n" };
const REQUIREMENTS: SolanaPaymentRequirements = {
  scheme: X402_SCHEME,
  amount: "1.00",
  asset: "USDC",
  network: "solana",
  payTo: MERCHANT,
  productId: "prod_1",
  resource: "checkout_session:cs_1",
  nonce: "n",
};

function verifier(tx = transferTx()) {
  return createSolanaPaymentVerifier({ rpc: fakeRpc({ transactions: { [PAYMENT_SIG]: tx } }), mint: USDC });
}

describe("createSolanaPaymentVerifier", () => {
  it("accepts a matching USDC transfer", async () => {
    expect(await verifier()(PROOF, REQUIREMENTS)).toEqual({ ok: true });
  });

  it("enforces the session reference when the requirements carry one", async () => {
    const withRef = { ...REQUIREMENTS, reference: REFERENCE };
    expect(await verifier()(PROOF, withRef)).toEqual({ ok: true });
    const result = await verifier(transferTx({ includeReference: false }))(PROOF, withRef);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/reference/);
  });

  it("rejects underpayment by one base unit", async () => {
    const result = await verifier()(PROOF, { ...REQUIREMENTS, amount: "1.000001" });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/expected at least 1000001/);
  });

  it("rejects EVM-shaped proofs, other networks and non-USDC assets", async () => {
    const v = verifier();
    expect((await v({ ...PROOF, txHash: `0x${"ab".repeat(32)}` }, REQUIREMENTS)).ok).toBe(false);
    expect((await v({ ...PROOF, network: "base" }, REQUIREMENTS)).ok).toBe(false);
    expect((await v(PROOF, { ...REQUIREMENTS, payTo: "0xMerchant" })).ok).toBe(false);
    expect((await v(PROOF, { ...REQUIREMENTS, asset: "EURC" as "USDC" })).ok).toBe(false);
  });

  it("fails when the transaction is unknown", async () => {
    const v = createSolanaPaymentVerifier({ rpc: fakeRpc(), mint: USDC });
    const result = await v(PROOF, REQUIREMENTS);
    expect(result).toMatchObject({ ok: false });
    expect(result.reason).toMatch(/not found/);
  });
});
