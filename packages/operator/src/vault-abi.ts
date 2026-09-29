/**
 * OperatorVault ABI surface used off-chain (viem) plus the canonical
 * function signatures Circle's contract-execution API expects.
 * Mirrors contracts/src/OperatorVault.sol; `Bucket` is a uint8 enum.
 */
import { parseAbi } from "viem";

export const OPERATOR_VAULT_ABI = parseAbi([
  "function allocate(bytes32 decisionHash, uint256[4] amounts)",
  "function pay(bytes32 decisionHash, uint8 bucket, address to, uint256 amount) returns (uint256)",
  "function sweepToYield(bytes32 decisionHash, uint256 amount)",
  "function redeemFromYield(bytes32 decisionHash, uint256 amount)",
  "function approve(uint256 id)",
  "function reject(uint256 id)",
  "function expire(uint256 id)",
  "function setCaps(bytes32 decisionHash, uint256 perTxCap, uint256 dailyCap, uint256 escalateAbove)",
  "function setAllowlist(bytes32 decisionHash, address payee, bool allowed)",
  "function pause()",
  "function unpause()",
  "function buckets() view returns (uint256[4])",
  "function unallocated() view returns (uint256)",
  "function pendingReserved() view returns (uint256)",
  "function yieldDeployed() view returns (uint256)",
  "function yieldAdapter() view returns (address)",
  "function paused() view returns (bool)",
  "function spentToday() view returns (uint256)",
  "function perTxCap() view returns (uint256)",
  "function dailyCap() view returns (uint256)",
  "function escalateAbove() view returns (uint256)",
  "function allowlisted(address) view returns (bool)",
  "function owner() view returns (address)",
  "function operator() view returns (address)",
  "event DecisionAnchored(bytes32 indexed decisionHash, bytes32 indexed action)",
  "event Escalated(uint256 indexed id, bytes32 indexed decisionHash, uint8 bucket, address indexed to, uint256 amount)",
  "event Paid(bytes32 indexed decisionHash, uint8 indexed bucket, address indexed to, uint256 amount)",
]);

export type VaultWriteFunction =
  | "allocate"
  | "pay"
  | "sweepToYield"
  | "redeemFromYield"
  | "approve"
  | "reject"
  | "expire"
  | "setCaps"
  | "setAllowlist"
  | "pause"
  | "unpause";

/** Solidity signatures for Circle `abiFunctionSignature`. */
export const VAULT_SIGNATURES: Readonly<Record<VaultWriteFunction, string>> = {
  allocate: "allocate(bytes32,uint256[4])",
  pay: "pay(bytes32,uint8,address,uint256)",
  sweepToYield: "sweepToYield(bytes32,uint256)",
  redeemFromYield: "redeemFromYield(bytes32,uint256)",
  approve: "approve(uint256)",
  reject: "reject(uint256)",
  expire: "expire(uint256)",
  setCaps: "setCaps(bytes32,uint256,uint256,uint256)",
  setAllowlist: "setAllowlist(bytes32,address,bool)",
  pause: "pause()",
  unpause: "unpause()",
};

export type VaultArg = string | bigint | number | boolean | readonly bigint[];

/** One state-changing vault call, transport-agnostic. */
export interface VaultCall {
  readonly functionName: VaultWriteFunction;
  readonly args: readonly VaultArg[];
}

/** Circle ABI parameters are JSON: integers as decimal strings, arrays nested. */
export function toCircleParameters(args: readonly VaultArg[]): readonly (string | boolean | readonly string[])[] {
  return args.map((a) => {
    if (typeof a === "bigint" || typeof a === "number") return a.toString();
    if (Array.isArray(a)) return (a as readonly bigint[]).map((x) => x.toString());
    return a as string | boolean;
  });
}
