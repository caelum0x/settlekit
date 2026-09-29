/**
 * Operator policy engine — the off-chain mirror of OperatorVault's rules.
 *
 * `evaluate()` decides whether a proposed spend is allowed, must be escalated
 * to the human owner, or is denied. Hard (deny) reasons are listed in exactly
 * the order OperatorVault.pay checks them, so `reasons[0]` of a deny verdict is
 * the custom error the vault would revert with:
 *
 *   paused -> IsPaused, tax_locked -> TaxLocked, zero_amount -> ZeroAmount,
 *   not_allowlisted -> NotAllowlisted, per_tx_cap_exceeded -> PerTxCapExceeded,
 *   insufficient_bucket -> InsufficientBucket, daily_cap_exceeded -> DailyCapExceeded
 *
 * As on-chain, an amount above `escalateAbove` escalates instead of paying and
 * skips the daily cap (the owner's approval is the authority). Off-chain-only
 * gates (risk, compliance, min float, x402 budget) are stricter than the vault,
 * never looser. Allowlist and UTC-day spend reuse `@settlekit/treasury`.
 */
import { fromBaseUnits, money, toBaseUnits } from "@settlekit/common";
import { decideCompliance, type ComplianceSignal } from "@settlekit/compliance";
import type { RiskDecision } from "@settlekit/risk";
import { evaluate as evaluateTreasury, type TreasuryPolicy } from "@settlekit/treasury";
import type { Bucket, VaultSnapshot } from "./types.js";

export const BPS = 10_000;

/** Operator policy. Money fields are USDC base units (6 dp). */
export interface OperatorPolicy {
  /** Split of net-of-tax revenue in basis points; must sum to 10_000. */
  readonly split: Readonly<{ OPERATING: number; YIELD: number; REFUND: number }>;
  /** Share of gross revenue reserved to TAX, in basis points. */
  readonly taxRateBps: number;
  readonly perTxCap: bigint;
  readonly dailyCap: bigint;
  readonly escalateAbove: bigint;
  /** OPERATING balance the agent should not dip below without a human. */
  readonly minFloat: bigint;
  /** Target USDC principal deployed into the yield adapter. */
  readonly yieldTarget: bigint;
  /** Payees the vault accepts (mirrors on-chain `allowlisted`). */
  readonly allowlist: readonly string[];
  /** Max x402 service purchases per UTC day before escalating. */
  readonly maxX402PerDay: number;
}

export type SpendKind = "payout" | "refund" | "x402";

export interface SpendRequest {
  readonly kind: SpendKind;
  readonly bucket: Bucket;
  readonly to: string;
  readonly amount: bigint;
}

export interface EvaluationContext {
  readonly now: Date;
  readonly vault: VaultSnapshot;
  /** x402 purchases already made in the current UTC day. */
  readonly x402PurchasesToday?: number;
  /** Verdict from `@settlekit/risk` for the counterparty, when assessed. */
  readonly risk?: RiskDecision;
  /** Signals from `@settlekit/compliance` screening, when screened. */
  readonly complianceSignals?: readonly ComplianceSignal[];
}

/** Reasons that the vault itself would revert on (plus hard off-chain blocks). */
export type DenyReason =
  | "paused"
  | "tax_locked"
  | "zero_amount"
  | "not_allowlisted"
  | "per_tx_cap_exceeded"
  | "insufficient_bucket"
  | "daily_cap_exceeded"
  | "risk_block"
  | "compliance_block";

export type EscalateReason =
  | "above_escalation_threshold"
  | "below_min_float"
  | "risk_review"
  | "compliance_review"
  | "x402_daily_limit";

export type PolicyReason = DenyReason | EscalateReason;

export interface PolicyVerdict {
  readonly decision: "allow" | "escalate" | "deny";
  readonly reasons: readonly PolicyReason[];
  /** Where an escalation is held: in the vault (Pending) or off-chain only. */
  readonly escalation?: "vault" | "offchain";
  /** Operator spend already counted in the request's UTC day. */
  readonly spentToday: bigint;
}

/** Map a deny reason to the OperatorVault custom error name. */
export const VAULT_ERROR: Readonly<Partial<Record<DenyReason, string>>> = {
  paused: "IsPaused",
  tax_locked: "TaxLocked",
  zero_amount: "ZeroAmount",
  not_allowlisted: "NotAllowlisted",
  per_tx_cap_exceeded: "PerTxCapExceeded",
  insufficient_bucket: "InsufficientBucket",
  daily_cap_exceeded: "DailyCapExceeded",
};

/** Pure evaluation of a spend request. Never mutates inputs. */
export function evaluate(
  policy: OperatorPolicy,
  request: SpendRequest,
  ctx: EvaluationContext,
): PolicyVerdict {
  const treasury = treasuryGates(policy, request, ctx);
  const vaultEscalates = request.amount > policy.escalateAbove;
  const deny = denyReasons(policy, request, ctx, treasury, vaultEscalates);
  if (deny.length > 0) {
    return { decision: "deny", reasons: deny, spentToday: treasury.spentToday };
  }
  const escalate = escalateReasons(policy, request, ctx, vaultEscalates);
  if (escalate.length > 0) {
    return {
      decision: "escalate",
      reasons: escalate,
      escalation: vaultEscalates ? "vault" : "offchain",
      spentToday: treasury.spentToday,
    };
  }
  return { decision: "allow", reasons: [], spentToday: treasury.spentToday };
}

interface TreasuryGates {
  readonly allowlisted: boolean;
  readonly withinDaily: boolean;
  readonly spentToday: bigint;
}

/** Allowlist + UTC-day window via the shared treasury policy engine. */
function treasuryGates(
  policy: OperatorPolicy,
  request: SpendRequest,
  ctx: EvaluationContext,
): TreasuryGates {
  const treasuryPolicy: TreasuryPolicy = {
    requiredApprovals: 0,
    dailyLimit: money(fromBaseUnits(policy.dailyCap)),
    destinationAllowlist: [...policy.allowlist],
  };
  const spends = ctx.vault.spends.map((s) => ({ amount: money(fromBaseUnits(s.amount)), at: s.at }));
  const amount = request.amount > 0n ? request.amount : 0n;
  const result = evaluateTreasury(
    treasuryPolicy,
    { spends },
    { sourceWalletId: "operator-vault", destination: request.to, amount: money(fromBaseUnits(amount)), approvals: [] },
    ctx.now,
  );
  return {
    // The vault has no "allow any" mode: an empty allowlist allows nobody.
    allowlisted: policy.allowlist.length > 0 && !result.reasons.includes("destination_not_allowed"),
    withinDaily: !result.reasons.includes("daily_limit_exceeded"),
    spentToday: toBaseUnits(result.spentInWindow.amount),
  };
}

function denyReasons(
  policy: OperatorPolicy,
  request: SpendRequest,
  ctx: EvaluationContext,
  treasury: TreasuryGates,
  vaultEscalates: boolean,
): DenyReason[] {
  const reasons: DenyReason[] = [];
  if (ctx.vault.paused) reasons.push("paused");
  if (request.bucket === "TAX") reasons.push("tax_locked");
  if (request.amount <= 0n) reasons.push("zero_amount");
  if (!treasury.allowlisted) reasons.push("not_allowlisted");
  if (request.amount > policy.perTxCap) reasons.push("per_tx_cap_exceeded");
  if (request.amount > ctx.vault.buckets[request.bucket]) reasons.push("insufficient_bucket");
  if (!vaultEscalates && !treasury.withinDaily) reasons.push("daily_cap_exceeded");
  if (ctx.risk === "block") reasons.push("risk_block");
  if (ctx.complianceSignals && decideCompliance([...ctx.complianceSignals]) === "block") {
    reasons.push("compliance_block");
  }
  return reasons;
}

function escalateReasons(
  policy: OperatorPolicy,
  request: SpendRequest,
  ctx: EvaluationContext,
  vaultEscalates: boolean,
): EscalateReason[] {
  const reasons: EscalateReason[] = [];
  if (vaultEscalates) reasons.push("above_escalation_threshold");
  if (request.bucket === "OPERATING" && ctx.vault.buckets.OPERATING - request.amount < policy.minFloat) {
    reasons.push("below_min_float");
  }
  if (ctx.risk === "review") reasons.push("risk_review");
  if (ctx.complianceSignals && decideCompliance([...ctx.complianceSignals]) === "review") {
    reasons.push("compliance_review");
  }
  if (request.kind === "x402" && (ctx.x402PurchasesToday ?? 0) >= policy.maxX402PerDay) {
    reasons.push("x402_daily_limit");
  }
  return reasons;
}

/** Validate a policy; same cap relations as OperatorVault._validateCaps. */
export function validatePolicy(policy: OperatorPolicy): readonly string[] {
  const errors: string[] = [];
  const { OPERATING, YIELD, REFUND } = policy.split;
  const parts = [OPERATING, YIELD, REFUND, policy.taxRateBps];
  if (parts.some((p) => !Number.isInteger(p) || p < 0 || p > BPS)) {
    errors.push("split and taxRateBps must be integers in [0, 10000]");
  }
  if (OPERATING + YIELD + REFUND !== BPS) errors.push("split must sum to 10000 bps");
  if (policy.perTxCap <= 0n) errors.push("perTxCap must be positive");
  if (policy.dailyCap < policy.perTxCap) errors.push("dailyCap must be >= perTxCap");
  if (policy.escalateAbove > policy.perTxCap) errors.push("escalateAbove must be <= perTxCap");
  if (policy.minFloat < 0n || policy.yieldTarget < 0n) errors.push("minFloat and yieldTarget must be >= 0");
  if (!Number.isInteger(policy.maxX402PerDay) || policy.maxX402PerDay < 0) {
    errors.push("maxX402PerDay must be a non-negative integer");
  }
  return errors;
}
