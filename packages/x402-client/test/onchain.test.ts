import { describe, expect, it } from "vitest";
import { LocalSettlementProvider } from "@settlekit/settlement-core";
import type { PaymentProof, PaymentRequirements } from "@settlekit/x402";
import { createProviderSettler } from "../src/provider-settler.js";
import { createOnchainVerifier } from "../src/onchain-verifier.js";
import type { IndexedTransfer, IndexerClient } from "../src/indexer-client.js";

const requirements: PaymentRequirements = {
  scheme: "x402",
  amount: "0.0008",
  asset: "USDC",
  network: "arc",
  payTo: "0xPayTo",
  productId: "src_1",
  nonce: "nonce-1",
};

describe("createProviderSettler", () => {
  it("settles an x402 challenge through a settlement provider", async () => {
    const provider = new LocalSettlementProvider();
    const settler = createProviderSettler(provider);
    const proof = await settler.settle({ requirements, from: "0xAgent" });
    expect(proof.from).toBe("0xAgent");
    expect(proof.amount).toBe("0.0008");
    expect(proof.nonce).toBe("nonce-1");
    expect(proof.txHash.length).toBeGreaterThan(0);
    // The nonce is the settlement reference, so a repeat is idempotent.
    await settler.settle({ requirements, from: "0xAgent" });
    expect(provider.all()).toHaveLength(1);
  });
});

describe("createOnchainVerifier", () => {
  const indexerWith = (transfer: IndexedTransfer | null): IndexerClient => ({
    getTransfer: async () => transfer,
  });
  const proof: PaymentProof = {
    txHash: "0xabc",
    from: "0xAgent",
    amount: "0.0008",
    network: "arc",
    nonce: "nonce-1",
  };

  it("accepts a confirmed, correct transfer", async () => {
    const verify = createOnchainVerifier({
      indexer: indexerWith({ txHash: "0xabc", to: "0xPayTo", amountUsdc: "0.0008", network: "arc", confirmations: 3 }),
    });
    expect(await verify(proof, requirements)).toEqual({ ok: true });
  });

  it("rejects a missing transfer", async () => {
    const verify = createOnchainVerifier({ indexer: indexerWith(null) });
    const result = await verify(proof, requirements);
    expect(result.ok).toBe(false);
  });

  it("rejects an underpayment", async () => {
    const verify = createOnchainVerifier({
      indexer: indexerWith({ txHash: "0xabc", to: "0xPayTo", amountUsdc: "0.0001", network: "arc", confirmations: 3 }),
    });
    expect((await verify(proof, requirements)).ok).toBe(false);
  });

  it("rejects insufficient confirmations", async () => {
    const verify = createOnchainVerifier({
      minConfirmations: 2,
      indexer: indexerWith({ txHash: "0xabc", to: "0xPayTo", amountUsdc: "0.0008", network: "arc", confirmations: 1 }),
    });
    expect((await verify(proof, requirements)).ok).toBe(false);
  });
});
