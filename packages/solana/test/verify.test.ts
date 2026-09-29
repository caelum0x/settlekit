import { describe, expect, it } from "vitest";
import { evaluateSplTransfer, tokenDeltasByOwner, verifySplTransfer } from "../src/verify.js";
import {
  BUYER,
  FAKE_USDC,
  MERCHANT,
  OTHER_WALLET,
  OTHER_WALLET_ATA,
  PAYMENT_SIG,
  REFERENCE,
  USDC,
  fakeRpc,
  multiTransferTx,
  sig,
  transferTx,
} from "./fixtures.js";

const BASE = {
  signature: PAYMENT_SIG,
  mint: USDC,
  recipientOwner: MERCHANT,
  minAmount: 1_000_000n,
};

describe("verifySplTransfer", () => {
  it("accepts an exact USDC payment to the merchant and identifies the payer", async () => {
    const rpc = fakeRpc({ transactions: { [PAYMENT_SIG]: transferTx() } });
    const result = await verifySplTransfer(rpc, { ...BASE, reference: REFERENCE });
    expect(result).toMatchObject({ ok: true, received: 1_000_000n, payer: BUYER, slot: 291_550_123 });
    expect(rpc.calls[0]).toEqual({ method: "getTransaction", args: [PAYMENT_SIG, "confirmed"] });
  });

  it("passes the requested commitment through to the RPC", async () => {
    const rpc = fakeRpc({ transactions: { [PAYMENT_SIG]: transferTx() } });
    await verifySplTransfer(rpc, { ...BASE, commitment: "finalized" });
    expect(rpc.calls[0]?.args[1]).toBe("finalized");
  });

  it("accepts an overpayment", async () => {
    const rpc = fakeRpc({ transactions: { [PAYMENT_SIG]: transferTx({ amount: 1_500_000n }) } });
    const result = await verifySplTransfer(rpc, BASE);
    expect(result).toMatchObject({ ok: true, received: 1_500_000n });
  });

  it("rejects a payment underpaid by a single base unit", async () => {
    const rpc = fakeRpc({ transactions: { [PAYMENT_SIG]: transferTx({ amount: 999_999n }) } });
    const result = await verifySplTransfer(rpc, BASE);
    expect(result).toMatchObject({ ok: false, reason: "underpaid", received: 999_999n });
  });

  it("rejects a transfer of the wrong mint (look-alike token)", async () => {
    const rpc = fakeRpc({ transactions: { [PAYMENT_SIG]: transferTx({ mint: FAKE_USDC }) } });
    const result = await verifySplTransfer(rpc, BASE);
    expect(result).toMatchObject({ ok: false, reason: "no_matching_transfer" });
  });

  it("rejects USDC sent to a different owner", async () => {
    const rpc = fakeRpc({
      transactions: {
        [PAYMENT_SIG]: transferTx({ recipient: OTHER_WALLET, recipientAta: OTHER_WALLET_ATA }),
      },
    });
    const result = await verifySplTransfer(rpc, BASE);
    expect(result).toMatchObject({ ok: false, reason: "no_matching_transfer" });
  });

  it("rejects a transaction that failed on-chain (meta.err set)", async () => {
    const rpc = fakeRpc({
      transactions: {
        [PAYMENT_SIG]: transferTx({ err: { InstructionError: [1, { Custom: 1 }] } }),
      },
    });
    const result = await verifySplTransfer(rpc, BASE);
    expect(result).toMatchObject({ ok: false, reason: "transaction_failed" });
    if (!result.ok) expect(result.message).toContain("InstructionError");
  });

  it("reports not_found when the RPC returns null", async () => {
    const result = await verifySplTransfer(fakeRpc(), BASE);
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("requires the reference when one is given", async () => {
    const rpc = fakeRpc({ transactions: { [PAYMENT_SIG]: transferTx({ includeReference: false }) } });
    expect(await verifySplTransfer(rpc, BASE)).toMatchObject({ ok: true });
    expect(await verifySplTransfer(rpc, { ...BASE, reference: REFERENCE })).toMatchObject({
      ok: false,
      reason: "reference_missing",
    });
  });

  it("accepts the reference when present", async () => {
    const rpc = fakeRpc({ transactions: { [PAYMENT_SIG]: transferTx({ includeReference: true }) } });
    expect(await verifySplTransfer(rpc, { ...BASE, reference: REFERENCE })).toMatchObject({ ok: true });
  });

  it("counts the full amount when the recipient ATA is created in the same tx", async () => {
    const tx = transferTx({ recipientPre: null, amount: 2_000_000n });
    expect(tx.meta?.preTokenBalances?.some((b) => b.owner === MERCHANT)).toBe(false);
    const result = evaluateSplTransfer(tx, { ...BASE, minAmount: 2_000_000n });
    expect(result).toMatchObject({ ok: true, received: 2_000_000n, payer: BUYER });
  });

  describe("multi-transfer transaction", () => {
    const tx = multiTransferTx();
    const signature = sig(2);

    it("sums every USDC transfer to the merchant and ignores other mints", () => {
      expect(evaluateSplTransfer(tx, { ...BASE, signature, minAmount: 1_000_000n })).toMatchObject({
        ok: true,
        received: 1_000_000n,
        payer: BUYER,
      });
    });

    it("does not let a look-alike token inflate the merchant total", () => {
      expect(evaluateSplTransfer(tx, { ...BASE, signature, minAmount: 1_000_001n })).toMatchObject({
        ok: false,
        reason: "underpaid",
        received: 1_000_000n,
      });
    });

    it("attributes the platform fee to its own owner", () => {
      expect(
        evaluateSplTransfer(tx, { ...BASE, signature, recipientOwner: OTHER_WALLET, minAmount: 50_000n }),
      ).toMatchObject({ ok: true, received: 50_000n });
    });

    it("exposes per-owner deltas for the mint", () => {
      const deltas = tokenDeltasByOwner(tx, USDC);
      expect(deltas.get(BUYER)).toBe(-1_050_000n);
      expect(deltas.get(MERCHANT)).toBe(1_000_000n);
      expect(deltas.get(OTHER_WALLET)).toBe(50_000n);
      expect(tokenDeltasByOwner(tx, FAKE_USDC).get(MERCHANT)).toBe(900_000_000n);
    });
  });
});
