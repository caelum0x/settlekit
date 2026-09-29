/**
 * Executor interfaces: how decisions reach the vault.
 *
 * `OperatorExecutor` is the agent side (OperatorVault's `onlyOperator`
 * functions); `OwnerExecutor` is the human side. Implementations: the
 * in-memory `LocalExecutor` (tests, demos) and, in wave 2, a Circle DCW
 * contract-execution `VaultExecutor`.
 */
import type { Proposal } from "./actions.js";
import type { Bucket, BucketBalances, VaultSnapshot } from "./types.js";

export interface TxResult {
  readonly txHash: string;
}

export interface PayResult extends TxResult {
  readonly status: "paid" | "escalated";
  readonly escalationId?: number;
}

export interface VaultCaps {
  readonly perTxCap: bigint;
  readonly dailyCap: bigint;
  readonly escalateAbove: bigint;
}

export interface OperatorExecutor {
  snapshot(): Promise<VaultSnapshot>;
  allocate(decisionHash: string, amounts: BucketBalances): Promise<TxResult>;
  pay(decisionHash: string, bucket: Bucket, to: string, amount: bigint): Promise<PayResult>;
  sweepToYield(decisionHash: string, amount: bigint): Promise<TxResult>;
  redeemFromYield(decisionHash: string, amount: bigint): Promise<TxResult>;
}

export interface OwnerExecutor {
  approve(escalationId: number): Promise<TxResult>;
  reject(escalationId: number): Promise<TxResult>;
  expire(escalationId: number): Promise<TxResult>;
  setCaps(decisionHash: string, caps: VaultCaps): Promise<TxResult>;
  setAllowlist(decisionHash: string, payee: string, allowed: boolean): Promise<TxResult>;
  pause(): Promise<TxResult>;
  unpause(): Promise<TxResult>;
}

/** On-chain configuration reads, used to refuse off-chain policy drift. */
export interface VaultStateReader {
  caps(): Promise<VaultCaps>;
  isAllowlisted(payee: string): Promise<boolean>;
}

/** Custom errors of OperatorVault, by name. */
export type VaultErrorCode =
  | "IsPaused"
  | "ZeroAddress"
  | "ZeroAmount"
  | "TaxLocked"
  | "NotAllowlisted"
  | "PerTxCapExceeded"
  | "DailyCapExceeded"
  | "InsufficientBucket"
  | "OverAllocation"
  | "InvalidCaps"
  | "YieldDisabled"
  | "InsufficientYield"
  | "NotPending"
  | "EscalationExpired"
  | "EscalationNotExpired";

export class VaultError extends Error {
  readonly code: VaultErrorCode;
  constructor(code: VaultErrorCode) {
    super(`OperatorVault reverted: ${code}`);
    this.name = "VaultError";
    this.code = code;
  }
}

/**
 * A vault transaction was broadcast but did not confirm successfully
 * (reverted, or the receipt could not be read). Carries the txHash so the
 * decision log still records the transaction for reconciliation.
 */
export class VaultTxError extends Error {
  constructor(
    readonly txHash: string,
    readonly kind: "reverted" | "unconfirmed",
    detail: string,
  ) {
    super(`vault transaction ${txHash} ${kind}: ${detail}`);
    this.name = "VaultTxError";
  }
}

/**
 * Execute an executable proposal (allocate / payout / refund / yield moves).
 * Returns null for non-executable kinds (escalate, decline, defer), for
 * denied verdicts, and for off-chain escalations (those wait for a human in
 * the escalation queue). Vault escalations are sent: the vault holds them.
 */
export async function executeProposal(
  executor: OperatorExecutor,
  decisionHash: string,
  p: Proposal,
): Promise<TxResult | PayResult | null> {
  const verdict = p.verdict;
  if (verdict && (verdict.decision === "deny" || (verdict.decision === "escalate" && verdict.escalation !== "vault"))) {
    return null;
  }
  const action = p.action;
  switch (action.kind) {
    case "allocate":
      return executor.allocate(decisionHash, action.amounts);
    case "payout":
      return executor.pay(decisionHash, action.bucket, action.to, action.amount);
    case "refund":
      return executor.pay(decisionHash, "REFUND", action.to, action.amount);
    case "sweep_to_yield":
      return executor.sweepToYield(decisionHash, action.amount);
    case "redeem_from_yield":
      return executor.redeemFromYield(decisionHash, action.amount);
    default:
      return null;
  }
}
