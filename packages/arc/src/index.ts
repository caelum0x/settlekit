/**
 * @settlekit/arc — Arc network (EVM USDC) settlement verification.
 *
 * Provides real on-chain reads via viem to confirm USDC ERC-20 transfers
 * from transaction receipts.
 */

export type ArcAddress = `0x${string}`;

export function isArcAddress(value: string): value is ArcAddress {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export interface ArcSettlementInstruction {
  network: "arc";
  to: ArcAddress;
  amount: string;
  currency: "USDC";
}

export { createArcClient } from "./arc-client.js";
export type { ArcClient, WaitForConfirmationsOptions } from "./arc-client.js";

export { createViemArcRpc } from "./rpc.js";
export type { ArcRpc } from "./rpc.js";

export {
  decodeTransferLog,
  decodeTransfers,
  normalizeAddress,
} from "./decode.js";

export { ARC_USDC_ABI, TRANSFER_EVENT_TOPIC } from "./usdc-abi.js";

export type {
  ArcClientConfig,
  ArcLog,
  ArcTransactionReceipt,
  DecodedUsdcTransfer,
  Hex,
  VerifyUsdcTransferParams,
  VerifyUsdcTransferResult,
} from "./types.js";
