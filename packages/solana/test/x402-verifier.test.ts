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

  // Before this fix, the Solana verifier never read `requirements.notBefore`
  // at all. In practice a plain checkout session always carries a Solana
  // Pay `reference` (impossible to forge into a past transaction), so the
  // main exposure this closes is defense-in-depth consistency with the EVM
  // and Zcash verifiers, which both already enforce it. (The one case with
  // no reference — a route provider's destination fill — has its own
  // separate, already-correct notBefore check that bypasses this adapter;
  // see `verifyRoutedSolanaFill` in apps/api/src/config/verifier-registry.ts.)
  it("enforces notBefore when the requirements declare a session creation time", async () => {
    // transferTx()'s blockTime is fixed at 1_727_600_000 (unix seconds).
    const oldTransfer = transferTx({ includeReference: false });
    const noReferenceRequirements = { ...REQUIREMENTS, notBefore: new Date(1_727_600_000_000 + 1_000_000).toISOString() };
    const result = await verifier(oldTransfer)(PROOF, noReferenceRequirements);
    expect(result).toMatchObject({ ok: false });
    expect(result.reason).toMatch(/mined before/);
  });

  it("enforces the payer binding when the requirements declare one", async () => {
    const withPayer = { ...REQUIREMENTS, payer: BUYER };
    expect(await verifier()(PROOF, withPayer)).toEqual({ ok: true });
    const otherWallet = "7oH4nq2SxuoczGGwJkxZpYJd88iHH4sUx9WTPt57pnSC";
    const result = await verifier()(PROOF, { ...REQUIREMENTS, payer: otherWallet });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/payer/);
  });
});
