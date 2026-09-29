import { describe, expect, it } from "vitest";
import { keccak256, stringToBytes } from "viem";
import {
  CLOCK_SKEW_MS,
  createEvmVerifier,
  getEvmChain,
  sessionMemo,
  TRANSFER_WITH_MEMO_TOPIC,
  type ChainEnv,
  type EvmChainKey,
  type Hex,
} from "../src/index.js";
import { firstTransfer, recorded, replayRpc, toReceipt, type RecordedReceipt } from "./fixture-rpc.js";

const CASES: Array<[string, EvmChainKey, ChainEnv]> = [
  ["ethereum-mainnet", "ethereum", "mainnet"],
  ["base-mainnet", "base", "mainnet"],
  ["arbitrum-mainnet", "arbitrum", "mainnet"],
  ["robinhood-mainnet", "robinhood", "mainnet"],
  ["hyperevm-mainnet", "hyperevm", "mainnet"],
  ["tempo-mainnet-memo", "tempo", "mainnet"],
  ["tempo-moderato-memo", "tempo", "testnet"],
  ["arc-testnet", "arc", "testnet"],
];

function setup(name: string, key: EvmChainKey, env: ChainEnv, rpcOptions: Parameters<typeof replayRpc>[1] = {}) {
  const record = recorded(name);
  const spec = getEvmChain(key, env)!;
  const verifier = createEvmVerifier({ spec, rpc: replayRpc(record, rpcOptions) });
  const transfer = firstTransfer(record);
  const blockTime = new Date(Number(BigInt(record.blockTimestamp)) * 1000);
  const params = {
    txHash: record.receipt.transactionHash,
    payTo: transfer.to,
    expectedBase: transfer.value,
  };
  return { record, spec, verifier, transfer, blockTime, params };
}

describe.each(CASES)("createEvmVerifier on %s", (name, key, env) => {
  it("confirms the recorded transfer (payTo, amount, payer, block time)", async () => {
    const { verifier, transfer, blockTime, params } = setup(name, key, env);
    const result = await verifier.verify({ ...params, payer: transfer.from, notBefore: blockTime });
    expect(result).toMatchObject({ ok: true, from: transfer.from, amountBase: transfer.value, confirmations: 100, blockTime });
  });

  it("accepts a checksummed or upper-case payTo/txHash", async () => {
    const { verifier, params } = setup(name, key, env);
    const result = await verifier.verify({ ...params, payTo: params.payTo.toUpperCase().replace("0X", "0x"), txHash: params.txHash.toUpperCase().replace("0X", "0x") });
    expect(result.ok).toBe(true);
  });

  it("rejects the wrong recipient, an underpayment and the wrong token", async () => {
    const { spec, record, verifier, params } = setup(name, key, env);
    expect(await verifier.verify({ ...params, payTo: "0x1111111111111111111111111111111111111111" })).toMatchObject({ ok: false, code: "no_transfer" });
    expect(await verifier.verify({ ...params, expectedBase: params.expectedBase + 1n })).toMatchObject({ ok: false, code: "underpaid" });
    const otherToken = createEvmVerifier({ spec, rpc: replayRpc(record), tokenAddress: "0x2222222222222222222222222222222222222222" });
    expect(await otherToken.verify(params)).toMatchObject({ ok: false, code: "no_transfer" });
  });

  it("rejects reverted and unmined transactions", async () => {
    const record = recorded(name);
    const reverted = setup(name, key, env, { receipt: { ...toReceipt(record), status: "reverted" } });
    expect(await reverted.verifier.verify(reverted.params)).toMatchObject({ ok: false, code: "reverted", retryable: false });
    const unmined = setup(name, key, env, { receipt: null });
    expect(await unmined.verifier.verify(unmined.params)).toMatchObject({ ok: false, code: "not_found", retryable: true });
  });

  it("waits for the chain's confirmation depth", async () => {
    const { spec } = setup(name, key, env);
    const shallow = setup(name, key, env, { confirmations: spec.minConfirmations - 1 });
    const result = await shallow.verifier.verify(shallow.params);
    if (spec.minConfirmations === 1) {
      expect(result).toMatchObject({ ok: false, code: "insufficient_confirmations", confirmations: 0 });
    } else {
      expect(result).toMatchObject({ ok: false, code: "insufficient_confirmations", retryable: true });
    }
    const exact = setup(name, key, env, { confirmations: spec.minConfirmations });
    expect((await exact.verifier.verify(exact.params)).ok).toBe(true);
  });

  it("fails closed when the RPC serves another chain", async () => {
    const { verifier, params } = setup(name, key, env, { chainId: 31337 });
    expect(await verifier.verify(params)).toMatchObject({ ok: false, code: "chain_mismatch" });
    await expect(verifier.assertChainId()).rejects.toThrow(/chain id mismatch/);
  });

  it("rejects transfers mined before the session (beyond clock skew)", async () => {
    const { verifier, blockTime, params } = setup(name, key, env);
    const tooLate = new Date(blockTime.getTime() + CLOCK_SKEW_MS + 1000);
    expect(await verifier.verify({ ...params, notBefore: tooLate })).toMatchObject({ ok: false, code: "too_old" });
    const withinSkew = new Date(blockTime.getTime() + CLOCK_SKEW_MS - 1000);
    expect((await verifier.verify({ ...params, notBefore: withinSkew })).ok).toBe(true);
  });

  it("enforces payer binding", async () => {
    const { verifier, params } = setup(name, key, env);
    const result = await verifier.verify({ ...params, payer: "0x3333333333333333333333333333333333333333" });
    expect(result).toMatchObject({ ok: false, code: "payer_mismatch" });
  });

  it("reports an unreachable RPC as retryable, never as paid", async () => {
    const record = recorded(name);
    const spec = getEvmChain(key, env)!;
    const down = { ...replayRpc(record), getTransactionReceipt: async () => Promise.reject(new Error("ECONNRESET")) };
    const verifier = createEvmVerifier({ spec, rpc: down });
    expect(await verifier.verify(setup(name, key, env).params)).toMatchObject({ ok: false, code: "rpc_unavailable", retryable: true });
  });

  it("rejects malformed hashes without touching the RPC", async () => {
    const { verifier, params } = setup(name, key, env);
    expect(await verifier.verify({ ...params, txHash: "0xdeadbeef" })).toMatchObject({ ok: false, code: "malformed" });
  });
});

function withMemo(record: RecordedReceipt, memo: Hex): RecordedReceipt {
  return {
    ...record,
    receipt: {
      ...record.receipt,
      logs: record.receipt.logs.map((log) =>
        log.topics[0] === TRANSFER_WITH_MEMO_TOPIC ? { ...log, topics: [log.topics[0], log.topics[1]!, log.topics[2]!, memo] } : log,
      ),
    },
  };
}

describe("Tempo TIP-20 memo binding and fee transfers", () => {
  const record = recorded("tempo-mainnet-memo");
  const spec = getEvmChain("tempo", "mainnet")!;
  const transfer = firstTransfer(record);
  const params = { txHash: record.receipt.transactionHash, payTo: transfer.to, expectedBase: transfer.value };

  it("computes the session memo as keccak256(sessionId)", () => {
    expect(sessionMemo("cs_123")).toBe(keccak256(stringToBytes("cs_123")));
  });

  it("rejects a memo'd transfer whose memo belongs to another session", async () => {
    const verifier = createEvmVerifier({ spec, rpc: replayRpc(record) });
    expect(await verifier.verify({ ...params, sessionId: "cs_mine" })).toMatchObject({ ok: false, code: "memo_mismatch" });
  });

  it("accepts the transfer when the memo is keccak256(sessionId)", async () => {
    const bound = withMemo(record, sessionMemo("cs_mine"));
    const verifier = createEvmVerifier({ spec, rpc: replayRpc(bound) });
    expect(await verifier.verify({ ...params, sessionId: "cs_mine", payer: transfer.from })).toMatchObject({ ok: true });
  });

  it("ignores the stablecoin fee Transfer paid to the fee manager", async () => {
    const verifier = createEvmVerifier({ spec, rpc: replayRpc(record) });
    // The recorded tx also moves 40 base units to the fee manager 0xfeec…; it
    // neither satisfies nor blocks verification for the real payee.
    const result = await verifier.verify({ ...params, payer: transfer.from });
    expect(result).toMatchObject({ ok: true, amountBase: 1000n });
    const feeOnly = await verifier.verify({ ...params, payTo: "0xfeec000000000000000000000000000000000000", expectedBase: 1000n });
    expect(feeOnly).toMatchObject({ ok: false, code: "underpaid" });
  });
});
