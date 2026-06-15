/**
 * Pure decoding logic for USDC `Transfer` events. Kept separate from the
 * RPC client so it can be unit-tested directly against canned receipt logs.
 */

import { decodeEventLog } from "viem";
import { ARC_USDC_ABI, TRANSFER_EVENT_TOPIC } from "./usdc-abi.js";
import type {
  ArcLog,
  ArcTransactionReceipt,
  DecodedUsdcTransfer,
  Hex,
} from "./types.js";

/** Lowercase an address-like hex string for case-insensitive comparison. */
export function normalizeAddress(address: Hex): Hex {
  return address.toLowerCase() as Hex;
}

/**
 * Decode a single log as a USDC `Transfer` event. Returns `null` when the log
 * is not a Transfer emitted by the given USDC contract (different event,
 * different contract, or malformed topics).
 */
export function decodeTransferLog(
  log: ArcLog,
  usdcAddress: Hex,
): DecodedUsdcTransfer | null {
  const signature = log.topics[0];
  if (signature === undefined) return null;
  if (signature.toLowerCase() !== TRANSFER_EVENT_TOPIC) return null;
  if (normalizeAddress(log.address) !== normalizeAddress(usdcAddress)) {
    return null;
  }

  const decoded = decodeEventLog({
    abi: ARC_USDC_ABI,
    eventName: "Transfer",
    topics: log.topics as [Hex, ...Hex[]],
    data: log.data,
  });

  const { from, to, value } = decoded.args;
  return {
    from: normalizeAddress(from as Hex),
    to: normalizeAddress(to as Hex),
    value: value as bigint,
    logIndex: log.logIndex,
  };
}

/** Decode every USDC `Transfer` event in a receipt for the given contract. */
export function decodeTransfers(
  receipt: ArcTransactionReceipt,
  usdcAddress: Hex,
): DecodedUsdcTransfer[] {
  const transfers: DecodedUsdcTransfer[] = [];
  for (const log of receipt.logs) {
    const decoded = decodeTransferLog(log, usdcAddress);
    if (decoded !== null) transfers.push(decoded);
  }
  return transfers;
}
