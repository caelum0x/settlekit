import { describe, expect, it } from "vitest";
import type { SettlementQuote } from "@settlekit/common";
import type { ZcashExplorer } from "@settlekit/zcash";
import {
  checkEvmChainIds,
  createEvmSettlementVerifier,
  createEvmVerifier,
  createZcashSettlementVerifier,
  getEvmChain,
  type SettlementRequirements,
} from "../src/index.js";
import { firstTransfer, recorded, replayRpc } from "./fixture-rpc.js";

const record = recorded("base-mainnet");
const transfer = firstTransfer(record);
const spec = getEvmChain("base", "mainnet")!;

function requirements(overrides: Partial<SettlementRequirements> = {}): SettlementRequirements {
  return {
    scheme: "x402",
    amount: (Number(transfer.value) / 1e6).toString(),
    asset: "USDC",
    network: "base",
    payTo: transfer.to,
    productId: "",
    resource: "checkout_session:cs_1",
    nonce: "",
    ...overrides,
  };
}

const proof = { txHash: record.receipt.transactionHash, from: "", amount: "", network: "base" as const, nonce: "" };

describe("createEvmSettlementVerifier", () => {
  const verifier = createEvmSettlementVerifier(createEvmVerifier({ spec, rpc: replayRpc(record) }));

  it("confirms a matching payment", async () => {
    expect(await verifier(proof, requirements())).toMatchObject({ ok: true, confirmations: 100 });
  });

  it("rejects other networks, unknown assets and bad amounts", async () => {
    expect(await verifier({ ...proof, network: "arc" }, requirements())).toEqual({ ok: false, reason: "Unsupported network: arc" });
    expect(await verifier(proof, requirements({ asset: "EURC" }))).toMatchObject({ ok: false, reason: expect.stringMatching(/Unsupported settlement asset/) });
    expect(await verifier(proof, requirements({ amount: "1.1234567" }))).toMatchObject({ ok: false, reason: expect.stringMatching(/Invalid amount/) });
  });

  it("passes notBefore and payer through to the rules", async () => {
    expect(await verifier(proof, requirements({ notBefore: "2099-01-01T00:00:00Z" }))).toMatchObject({ ok: false });
    expect(await verifier(proof, requirements({ payer: "0x3333333333333333333333333333333333333333" }))).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/payer/),
    });
  });

  it("routes extra assets to their own token verifier", async () => {
    const extra = createEvmSettlementVerifier(createEvmVerifier({ spec, rpc: replayRpc(record), tokenAddress: "0x1111111111111111111111111111111111111111" }), {
      EURC: createEvmVerifier({ spec, rpc: replayRpc(record) }),
    });
    expect((await extra(proof, requirements({ asset: "EURC" }))).ok).toBe(true);
    expect((await extra(proof, requirements())).ok).toBe(false);
  });
});

describe("checkEvmChainIds", () => {
  it("reports mismatches per chain", async () => {
    const good = createEvmVerifier({ spec, rpc: replayRpc(record) });
    const bad = createEvmVerifier({ spec: getEvmChain("tempo", "mainnet")!, rpc: replayRpc(record) });
    const results = await checkEvmChainIds([good, bad]);
    expect(results[0]).toEqual({ key: "base", ok: true });
    const unreachable = createEvmVerifier({
      spec,
      rpc: { ...replayRpc(record), getChainId: async () => Promise.reject(new Error("ECONNREFUSED")) },
    });
    expect((await checkEvmChainIds([unreachable]))[0]).toMatchObject({ ok: false, mismatch: false });
    expect(results[1]).toMatchObject({ key: "tempo", ok: false, mismatch: true, error: expect.stringMatching(/mismatch/) });
  });
});

describe("createZcashSettlementVerifier", () => {
  const TXID = "ab".repeat(32);
  const PAY_TO = "t1Ne88F8ouCV92brDXNBB47a85brvnEHE8g";
  const quote: SettlementQuote = {
    asset: "ZEC",
    amountBase: "1738266",
    decimals: 8,
    rate: "1438.25",
    source: "coinbase",
    lockedAt: "2026-09-29T12:00:00.000Z",
    expiresAt: "2026-09-29T12:15:00.000Z",
  };
  function explorer(blockTime: string, value: bigint, confirmations = 5): ZcashExplorer {
    return {
      getTransaction: async () => ({
        ok: true,
        value: { txid: TXID, blockHeight: 10, blockTime: new Date(blockTime), confirmations, outputs: [{ recipient: PAY_TO, value }], inputAddresses: [] },
      }),
      getAddressActivity: async () => ({ ok: true, value: [] }),
    };
  }
  const zProof = { txHash: TXID, from: "", amount: "", network: "zcash" as const, nonce: "" };
  const zReq: SettlementRequirements = {
    scheme: "x402", amount: "25", asset: "USDC", network: "zcash", payTo: PAY_TO, productId: "", resource: "r", nonce: "",
    notBefore: "2026-09-29T11:59:00.000Z", settlementQuote: quote,
  };

  it("maps confirmed / pending / late / rejected", async () => {
    const at = "2026-09-29T12:05:00Z";
    expect(await createZcashSettlementVerifier({ explorer: explorer(at, 1_738_266n), minConfirmations: 3 })(zProof, zReq)).toEqual({ ok: true, confirmations: 5 });
    expect(await createZcashSettlementVerifier({ explorer: explorer(at, 1_738_266n, 1), minConfirmations: 3 })(zProof, zReq)).toMatchObject({ ok: false, retryable: true });
    expect(await createZcashSettlementVerifier({ explorer: explorer("2026-09-29T12:30:00Z", 1_738_266n), minConfirmations: 3 })(zProof, zReq)).toMatchObject({ ok: false, late: true });
    expect(await createZcashSettlementVerifier({ explorer: explorer(at, 1_738_265n), minConfirmations: 3 })(zProof, zReq)).toMatchObject({ ok: false, reason: expect.stringMatching(/exactly/) });
  });

  it("fails closed without a locked quote or on another network", async () => {
    const verifier = createZcashSettlementVerifier({ explorer: explorer("2026-09-29T12:05:00Z", 1n), minConfirmations: 3 });
    const { settlementQuote: _omit, ...noQuote } = zReq;
    expect(await verifier(zProof, noQuote)).toEqual({ ok: false, reason: "session has no locked ZEC quote" });
    expect(await verifier({ ...zProof, network: "base" }, zReq)).toMatchObject({ ok: false });
  });
});
