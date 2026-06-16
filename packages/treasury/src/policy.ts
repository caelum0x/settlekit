/**
 * Treasury custody policy engine.
 *
 * Pure, deterministic functions that decide whether a requested USDC transfer
 * is permitted under a treasury policy, given the current spend state. No I/O,
 * no mutation — every function returns new values so the engine is safe to run
 * speculatively and easy to test.
 *
 * The policy enforces three independent gates:
 *   1. Multi-approval threshold — at least N distinct approvers.
 *   2. Per-period (daily) spend limit with calendar-day windowing — the request
 *      plus all spend already recorded in the current UTC day must stay at or
 *      below the limit.
 *   3. Destination allowlist — the destination must be explicitly allowed (when
 *      an allowlist is configured; an empty/omitted allowlist allows any).
 */
import { addMoney, compareMoney, subtractMoney, toIso } from "@settlekit/common";
import type { Money } from "@settlekit/common";
import type { TreasuryTransferIntent } from "./intent.js";

/** A treasury custody policy. Immutable configuration. */
export interface TreasuryPolicy {
  /** Minimum number of distinct approvers required to release a transfer. */
  requiredApprovals: number;
  /** Maximum total USDC that may be sent per UTC calendar day. */
  dailyLimit: Money;
  /**
   * Allowed destination addresses (case-insensitive). When omitted or empty,
   * any destination is permitted. Use an explicit allowlist for custody.
   */
  destinationAllowlist?: string[];
}

/** A single recorded spend used to reconstruct the current daily window. */
export interface SpendEntry {
  amount: Money;
  /** ISO-8601 timestamp the spend was committed. */
  at: string;
}

/** Mutable-over-time spend state, supplied to the engine as a snapshot. */
export interface TreasuryState {
  /** All spends the treasury has committed (any time range). */
  spends: SpendEntry[];
}

/** A requested transfer to evaluate against a policy + state. */
export interface TransferRequest {
  sourceWalletId: string;
  destination: string;
  amount: Money;
  /** Approver ids gathered for this request (duplicates are de-duplicated). */
  approvals: string[];
  refId?: string;
}

/** Machine-readable reason a request was denied. */
export type DenyReason =
  | "insufficient_approvals"
  | "daily_limit_exceeded"
  | "destination_not_allowed"
  | "invalid_amount";

/** Result of evaluating a request: allowed, plus any reasons for denial. */
export interface EvaluationResult {
  allowed: boolean;
  reasons: DenyReason[];
  /** Spend already counted in the request's UTC day (excludes the request). */
  spentInWindow: Money;
  /** Remaining headroom under the daily limit after this request, if allowed. */
  remainingAfter: Money;
}

const ZERO: Money = { amount: "0", currency: "USDC" };

/** UTC calendar-day key (YYYY-MM-DD) for windowing daily spend. */
export function dayKey(at: Date): string {
  return toIso(at).slice(0, 10);
}

/** Sum spends that fall within the same UTC day as `at`. */
export function spentInDay(state: TreasuryState, at: Date): Money {
  const key = dayKey(at);
  return state.spends.reduce<Money>((acc, entry) => {
    return dayKey(new Date(entry.at)) === key ? addMoney(acc, entry.amount) : acc;
  }, ZERO);
}

/** Distinct approver count (order-independent, duplicates removed). */
export function distinctApprovals(approvals: string[]): string[] {
  return [...new Set(approvals.filter((a) => typeof a === "string" && a.length > 0))];
}

function isAllowedDestination(policy: TreasuryPolicy, destination: string): boolean {
  const list = policy.destinationAllowlist;
  if (!list || list.length === 0) return true;
  const target = destination.toLowerCase();
  return list.some((addr) => addr.toLowerCase() === target);
}

/** True when `amount` is a positive USDC value. */
function isPositiveAmount(amount: Money): boolean {
  return compareMoney(amount, ZERO) === 1;
}

/**
 * Evaluate a transfer request against a policy and the current spend state.
 * Pure: never mutates inputs. `now` is injectable for deterministic tests.
 */
export function evaluate(
  policy: TreasuryPolicy,
  state: TreasuryState,
  request: TransferRequest,
  now: Date = new Date(),
): EvaluationResult {
  const reasons: DenyReason[] = [];

  if (!isPositiveAmount(request.amount)) {
    reasons.push("invalid_amount");
  }

  const approvers = distinctApprovals(request.approvals);
  if (approvers.length < policy.requiredApprovals) {
    reasons.push("insufficient_approvals");
  }

  if (!isAllowedDestination(policy, request.destination)) {
    reasons.push("destination_not_allowed");
  }

  const spentInWindow = spentInDay(state, now);
  const projected = addMoney(spentInWindow, request.amount);
  // Allowed when projected <= limit (compareMoney !== 1).
  const withinLimit = compareMoney(projected, policy.dailyLimit) !== 1;
  if (!withinLimit) {
    reasons.push("daily_limit_exceeded");
  }

  const remainingAfter = withinLimit
    ? subtractClamped(policy.dailyLimit, projected)
    : ZERO;

  return {
    allowed: reasons.length === 0,
    reasons,
    spentInWindow,
    remainingAfter,
  };
}

/**
 * Produce a validated transfer intent from a request, or throw with the deny
 * reasons. Use when the caller wants a ready-to-execute artifact and treats a
 * policy violation as exceptional.
 */
export function toTransferIntent(
  policy: TreasuryPolicy,
  state: TreasuryState,
  request: TransferRequest,
  now: Date = new Date(),
): TreasuryTransferIntent {
  const result = evaluate(policy, state, request, now);
  if (!result.allowed) {
    throw new TreasuryPolicyError(result.reasons);
  }
  return {
    sourceWalletId: request.sourceWalletId,
    destination: request.destination,
    amount: request.amount,
    approvals: distinctApprovals(request.approvals),
    refId: request.refId,
    createdAt: toIso(now),
  };
}

/** Append a committed spend to state immutably (new state returned). */
export function recordSpend(
  state: TreasuryState,
  amount: Money,
  at: Date = new Date(),
): TreasuryState {
  return { spends: [...state.spends, { amount, at: toIso(at) }] };
}

/** Thrown by `toTransferIntent` when a request violates policy. */
export class TreasuryPolicyError extends Error {
  readonly reasons: DenyReason[];
  constructor(reasons: DenyReason[]) {
    super(`Transfer denied by treasury policy: ${reasons.join(", ")}`);
    this.name = "TreasuryPolicyError";
    this.reasons = reasons;
  }
}

/** limit - projected, clamped at zero (never negative). */
function subtractClamped(limit: Money, projected: Money): Money {
  if (compareMoney(projected, limit) === 1) return ZERO;
  return subtractMoney(limit, projected);
}
