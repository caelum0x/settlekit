/**
 * Narrow EVM RPC interface for settlement verification plus a real default
 * implementation backed by viem's public client.
 *
 * `EvmRpc` is the generic seam shared by every EVM chain SettleKit verifies
 * (Arc, Base, Ethereum, Arbitrum, Robinhood Chain, HyperEVM, Tempo — see
 * `@settlekit/chains`). `ArcRpc` is kept as an alias for existing callers.
 * Tests inject an in-memory implementation returning canned receipts; the
 * domain logic (receipt decoding, confirmation counting) is identical.
 */

import { createPublicClient, http, type Chain } from "viem";
import type { ArcClientConfig, ArcTransactionReceipt, Hex } from "./types.js";

/** EIP-1559 fee components (18-decimal native units). */
export interface ArcFeesPerGas {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/** The on-chain reads EVM settlement verification depends on. */
export interface EvmRpc {
  /** Fetch a transaction receipt, or `null` if not yet mined. */
  getTransactionReceipt(txHash: Hex): Promise<ArcTransactionReceipt | null>;
  /** Current head block number. */
  getBlockNumber(): Promise<bigint>;
  /** Current EIP-1559 fee estimate for the chain. */
  estimateFeesPerGas(): Promise<ArcFeesPerGas>;
  /**
   * The chain id the endpoint actually serves (`eth_chainId`). Verifiers
   * assert it equals the configured chain so a mis-pointed RPC can never
   * confirm a payment made on another chain.
   */
  getChainId?(): Promise<number>;
  /** Unix timestamp (seconds) of block `blockNumber`. */
  getBlockTimestamp?(blockNumber: bigint): Promise<bigint>;
}

/** Back-compat alias: the Arc client's RPC is the generic {@link EvmRpc}. */
export type ArcRpc = EvmRpc;

/** An {@link EvmRpc} whose chain-id and block-time reads are guaranteed. */
export type FullEvmRpc = EvmRpc & Required<Pick<EvmRpc, "getChainId" | "getBlockTimestamp">>;

/** Options for {@link createViemEvmRpc}. */
export interface ViemEvmRpcOptions {
  rpcUrl: string;
  /**
   * viem chain definition. Supplying it enables chain-specific formatters
   * (e.g. Tempo's 0x76 transaction type) when decoding receipts.
   */
  chain?: Chain;
}

function isReceiptNotFound(error: unknown): boolean {
  // viem throws TransactionReceiptNotFoundError while a tx is unmined.
  return error instanceof Error && error.name === "TransactionReceiptNotFoundError";
}

/** Real {@link FullEvmRpc} backed by a viem public client. */
export function createViemEvmRpc(options: ViemEvmRpcOptions): FullEvmRpc {
  const client = createPublicClient({
    ...(options.chain ? { chain: options.chain } : {}),
    transport: http(options.rpcUrl),
  });

  return {
    async getTransactionReceipt(txHash: Hex): Promise<ArcTransactionReceipt | null> {
      try {
        const receipt = await client.getTransactionReceipt({ hash: txHash });
        return {
          transactionHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber,
          status: receipt.status,
          from: receipt.from,
          to: receipt.to,
          logs: receipt.logs.map((log) => ({
            address: log.address,
            topics: log.topics,
            data: log.data,
            logIndex: log.logIndex,
          })),
        };
      } catch (error) {
        if (isReceiptNotFound(error)) return null;
        throw error;
      }
    },

    async getBlockNumber(): Promise<bigint> {
      return client.getBlockNumber();
    },

    async estimateFeesPerGas(): Promise<ArcFeesPerGas> {
      const fees = await client.estimateFeesPerGas();
      return {
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      };
    },

    async getChainId(): Promise<number> {
      return client.getChainId();
    },

    async getBlockTimestamp(blockNumber: bigint): Promise<bigint> {
      const block = await client.getBlock({ blockNumber });
      return block.timestamp;
    },
  };
}

/** Real Arc RPC: the generic viem-backed {@link EvmRpc} at the Arc RPC URL. */
export function createViemArcRpc(config: ArcClientConfig): ArcRpc {
  return createViemEvmRpc({ rpcUrl: config.rpcUrl });
}
