/**
 * Replays receipts recorded from each chain's public RPC on 2026-09-29
 * (eth_getLogs for the registry token, then eth_getTransactionReceipt and
 * eth_getBlockByNumber). Only the token's logs were kept. No network.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ArcTransactionReceipt, FullEvmRpc } from "@settlekit/arc";
import type { Hex } from "../src/registry.js";

export interface RecordedReceipt {
  chainId: Hex;
  head: Hex;
  blockTimestamp: Hex;
  receipt: {
    transactionHash: Hex;
    blockNumber: Hex;
    status: Hex;
    from: Hex;
    to: Hex | null;
    logs: Array<{ address: Hex; topics: Hex[]; data: Hex; logIndex: Hex }>;
  };
}

export function recorded(name: string): RecordedReceipt {
  const path = fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as RecordedReceipt;
}

export function toReceipt(record: RecordedReceipt): ArcTransactionReceipt {
  const r = record.receipt;
  return {
    transactionHash: r.transactionHash,
    blockNumber: BigInt(r.blockNumber),
    status: r.status === "0x1" ? "success" : "reverted",
    from: r.from,
    to: r.to,
    logs: r.logs.map((log) => ({
      address: log.address,
      topics: log.topics as [Hex, ...Hex[]],
      data: log.data,
      logIndex: Number(log.logIndex),
    })),
  };
}

export interface ReplayOptions {
  /** Override the receipt (null = unmined). */
  receipt?: ArcTransactionReceipt | null;
  /** Confirmations to report (head = block + confirmations - 1). */
  confirmations?: number;
  chainId?: number;
}

/** A {@link FullEvmRpc} serving one recorded receipt. */
export function replayRpc(record: RecordedReceipt, options: ReplayOptions = {}): FullEvmRpc & { calls: string[] } {
  const calls: string[] = [];
  const receipt = options.receipt === undefined ? toReceipt(record) : options.receipt;
  const block = BigInt(record.receipt.blockNumber);
  return {
    calls,
    async getChainId() {
      calls.push("eth_chainId");
      return options.chainId ?? Number(record.chainId);
    },
    async getTransactionReceipt(hash) {
      calls.push("eth_getTransactionReceipt");
      return receipt !== null && hash === receipt.transactionHash.toLowerCase() ? receipt : null;
    },
    async getBlockNumber() {
      return block + BigInt((options.confirmations ?? 100) - 1);
    },
    async getBlockTimestamp(number) {
      if (number !== block) throw new Error(`unexpected block ${number}`);
      return BigInt(record.blockTimestamp);
    },
    async estimateFeesPerGas() {
      return { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n };
    },
  };
}

/** First standard Transfer in the record: payer, payee, value. */
export function firstTransfer(record: RecordedReceipt): { from: Hex; to: Hex; value: bigint } {
  const log = record.receipt.logs[0];
  if (log === undefined) throw new Error("fixture has no logs");
  return {
    from: `0x${log.topics[1]!.slice(-40)}` as Hex,
    to: `0x${log.topics[2]!.slice(-40)}` as Hex,
    value: BigInt(log.data),
  };
}
