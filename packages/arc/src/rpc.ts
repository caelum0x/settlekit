/**
 * Narrow RPC interface for Arc settlement verification plus a real default
 * implementation backed by viem's public client.
 *
 * The interface exists so domain logic (receipt decoding, confirmation
 * counting) can be exercised in tests with an in-memory transport that
 * returns canned receipts, while production uses real on-chain reads.
 */

import { createPublicClient, http } from "viem";
import type { ArcClientConfig, ArcTransactionReceipt, Hex } from "./types.js";

/** EIP-1559 fee components (18-decimal native/USDC units on Arc). */
export interface ArcFeesPerGas {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/** The on-chain reads the Arc client depends on. */
export interface ArcRpc {
  /** Fetch a transaction receipt, or `null` if not yet mined. */
  getTransactionReceipt(txHash: Hex): Promise<ArcTransactionReceipt | null>;
  /** Current head block number. */
  getBlockNumber(): Promise<bigint>;
  /** Current EIP-1559 fee estimate for the chain. */
  estimateFeesPerGas(): Promise<ArcFeesPerGas>;
}

/**
 * Real {@link ArcRpc} implementation wrapping a viem public client created
 * from the configured RPC URL.
 */
export function createViemArcRpc(config: ArcClientConfig): ArcRpc {
  const client = createPublicClient({
    transport: http(config.rpcUrl),
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
        // viem throws TransactionReceiptNotFoundError when the tx is not yet
        // mined. Surface that as `null` rather than an exception.
        if (
          error instanceof Error &&
          error.name === "TransactionReceiptNotFoundError"
        ) {
          return null;
        }
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
  };
}
