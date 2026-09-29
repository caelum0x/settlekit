/**
 * Stablecoin transfer decoding from EVM receipts: standard ERC-20
 * `Transfer(from,to,value)` plus Tempo TIP-20
 * `TransferWithMemo(from,to,amount,bytes32 indexed memo)`.
 */

import { decodeTransferLog, type ArcLog, type ArcTransactionReceipt } from "@settlekit/arc";
import { decodeAbiParameters, keccak256, stringToBytes, toEventSelector } from "viem";
import type { Hex } from "./registry.js";

export const TRANSFER_WITH_MEMO_TOPIC = toEventSelector(
  "TransferWithMemo(address,address,uint256,bytes32)",
);

export interface TokenTransfer {
  from: Hex;
  to: Hex;
  value: bigint;
  logIndex: number;
  /** bytes32 memo for TIP-20 `TransferWithMemo`, lowercase hex. */
  memo?: Hex;
}

function topicAddress(topic: Hex): Hex {
  return `0x${topic.slice(-40)}`.toLowerCase() as Hex;
}

function decodeMemoLog(log: ArcLog, token: Hex): TokenTransfer | null {
  const [signature, from, to, memo] = log.topics;
  if (signature?.toLowerCase() !== TRANSFER_WITH_MEMO_TOPIC) return null;
  if (log.address.toLowerCase() !== token.toLowerCase()) return null;
  if (from === undefined || to === undefined || memo === undefined) return null;
  const [value] = decodeAbiParameters([{ type: "uint256" }], log.data);
  return {
    from: topicAddress(from),
    to: topicAddress(to),
    value,
    logIndex: log.logIndex,
    memo: memo.toLowerCase() as Hex,
  };
}

/** Every Transfer / TransferWithMemo emitted by `token` in `receipt`. */
export function decodeTokenTransfers(receipt: ArcTransactionReceipt, token: Hex): TokenTransfer[] {
  return receipt.logs.flatMap((log) => {
    const memo = decodeMemoLog(log, token);
    if (memo !== null) return [memo];
    const plain = decodeTransferLog(log, token);
    return plain === null ? [] : [{ from: plain.from, to: plain.to, value: plain.value, logIndex: plain.logIndex }];
  });
}

/** The TIP-20 memo SettleKit binds a Tempo payment to: keccak256(sessionId). */
export function sessionMemo(sessionId: string): Hex {
  return keccak256(stringToBytes(sessionId)).toLowerCase() as Hex;
}
