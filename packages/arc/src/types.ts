/**
 * Public types for the Arc (EVM USDC) settlement verification client.
 */

import type { Money } from "@settlekit/common";

/** A 0x-prefixed hex string (transaction hash, address, topic, etc.). */
export type Hex = `0x${string}`;

/** Configuration for constructing an Arc settlement client. */
export interface ArcClientConfig {
  /** JSON-RPC HTTP endpoint for the Arc EVM chain. */
  rpcUrl: string;
  /** Deployed USDC ERC-20 contract address on the Arc chain. */
  usdcAddress: Hex;
  /** EVM chain id of the Arc network. */
  chainId: number;
}

/**
 * The subset of an EVM transaction receipt we depend on. This mirrors the
 * shape returned by viem's `getTransactionReceipt`, narrowed to the fields
 * used for settlement verification.
 */
export interface ArcTransactionReceipt {
  transactionHash: Hex;
  blockNumber: bigint;
  status: "success" | "reverted";
  from: Hex;
  to: Hex | null;
  logs: ArcLog[];
}

/** A single log entry emitted by a transaction. */
export interface ArcLog {
  address: Hex;
  topics: [signature: Hex, ...args: Hex[]] | [];
  data: Hex;
  logIndex: number;
}

/** Parameters for verifying a USDC transfer on the Arc chain. */
export interface VerifyUsdcTransferParams {
  /** Hash of the transaction that should contain the transfer. */
  txHash: Hex;
  /** The expected recipient address of the USDC transfer. */
  to: Hex;
  /** Minimum amount that must have been transferred (major-unit decimal). */
  minAmount: Money;
}

/** Result of verifying a USDC transfer. */
export interface VerifyUsdcTransferResult {
  /** True when a matching transfer >= minAmount to `to` was found. */
  confirmed: boolean;
  /** Sender of the matching transfer, if one was found. */
  from: Hex | null;
  /** The transferred amount of the matching transfer, if one was found. */
  amount: Money | null;
  /** Number of confirmations the transaction currently has. */
  confirmations: number;
}

/** A decoded USDC `Transfer` event. */
export interface DecodedUsdcTransfer {
  from: Hex;
  to: Hex;
  /** Transferred amount in bigint base units (6 decimals). */
  value: bigint;
  logIndex: number;
}
