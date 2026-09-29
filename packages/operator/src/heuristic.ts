/**
 * HeuristicOperator — deterministic decision engine.
 *
 * Given an event and a snapshot, produces proposals with rationale,
 * alternatives and confidence. No clock reads, randomness or I/O: identical
 * input always yields identical output, which makes it the reference engine
 * for tests and the fallback when the Claude engine is unavailable.
 */
import { fromBaseUnits } from "@settlekit/common";
import type { ComplianceSignal } from "@settlekit/compliance";
import type { RiskDecision } from "@settlekit/risk";
import { proposal, type Proposal, type ProposedAction } from "./actions.js";
import { allocate } from "./allocation.js";
import { digest } from "./decision-log.js";
import type { BillDue, DisputeOpened, OperatorEvent, RefundRequested, RevenueReceived, Tick } from "./events.js";
import { evaluate, type DenyReason, type OperatorPolicy, type PolicyVerdict, type SpendRequest } from "./policy.js";
import type { VaultSnapshot } from "./types.js";

export interface HeuristicContext {
  readonly policy: OperatorPolicy;
  readonly vault: VaultSnapshot;
  readonly now: Date;
  readonly risk?: RiskDecision;
  readonly complianceSignals?: readonly ComplianceSignal[];
  readonly x402PurchasesToday?: number;
}

export interface OperatorDecision {
  readonly eventRef: string;
  readonly model: string;
  readonly inputsDigest: string;
  readonly proposals: readonly Proposal[];
}

export const HEURISTIC_MODEL = "heuristic-v1";

const usdc = (amount: bigint): string => `${fromBaseUnits(amount)} USDC`;

/** Deny reasons a human can resolve (allowlist a payee, top up a bucket...). */
const HUMAN_FIXABLE: ReadonlySet<DenyReason> = new Set([
  "not_allowlisted",
  "per_tx_cap_exceeded",
  "insufficient_bucket",
  "tax_locked",
]);

export class HeuristicOperator {
  readonly model = HEURISTIC_MODEL;

  decide(event: OperatorEvent, ctx: HeuristicContext): OperatorDecision {
    return {
      eventRef: event.id,
      model: this.model,
      inputsDigest: digest({ event, policy: ctx.policy, vault: ctx.vault, now: ctx.now.toISOString(), risk: ctx.risk ?? null }),
      proposals: this.propose(event, ctx),
    };
  }

  private propose(event: OperatorEvent, ctx: HeuristicContext): readonly Proposal[] {
    if (ctx.vault.paused) {
      return [proposal({ kind: "defer", reason: "vault paused" }, "The owner paused the vault; no action until unpaused.", ["act anyway (would revert IsPaused)"], 1)];
    }
    switch (event.type) {
      case "revenue.received":
        return [onRevenue(event, ctx)];
      case "bill.due":
        return [onBill(event, ctx)];
      case "refund.requested":
        return [onRefund(event, ctx)];
      case "dispute.opened":
        return [onDispute(event, ctx)];
      case "tick":
        return onTick(event, ctx);
    }
  }
}

function onRevenue(event: RevenueReceived, ctx: HeuristicContext): Proposal {
  if (ctx.vault.unallocated < event.amount) {
    return proposal(
      { kind: "defer", reason: "inflow not yet visible in vault" },
      `Revenue ${usdc(event.amount)} reported but only ${usdc(ctx.vault.unallocated)} is unallocated; wait for settlement.`,
      ["allocate the visible amount only", "allocate anyway (would revert OverAllocation)"],
      0.9,
    );
  }
  const amounts = allocate(event.amount, ctx.policy);
  return proposal(
    { kind: "allocate", amounts },
    `Split ${usdc(event.amount)} from ${event.payer}: tax ${ctx.policy.taxRateBps} bps to TAX, remainder per policy split.`,
    ["hold unallocated until month end", "route everything to OPERATING"],
    0.95,
  );
}

function onDenied(verdict: PolicyVerdict, action: ProposedAction, label: string): Proposal {
  const reasons = verdict.reasons as readonly DenyReason[];
  const text = reasons.join(", ");
  if (reasons.includes("risk_block") || reasons.includes("compliance_block")) {
    return proposal({ kind: "decline", reason: text }, `${label}: counterparty blocked by screening (${text}).`, ["escalate to owner"], 0.95, verdict);
  }
  if (reasons.some((r) => HUMAN_FIXABLE.has(r))) {
    return proposal(
      { kind: "escalate", reason: text, subject: action },
      `${label}: blocked by policy (${text}); a human can resolve it.`,
      ["decline outright", "defer to next tick"],
      0.8,
      verdict,
    );
  }
  return proposal({ kind: "defer", reason: text }, `${label}: not possible now (${text}); retry on a later tick.`, ["escalate to owner"], 0.85, verdict);
}

function evaluateWith(ctx: HeuristicContext): (request: SpendRequest) => PolicyVerdict {
  return (request) =>
    evaluate(ctx.policy, request, {
      now: ctx.now,
      vault: ctx.vault,
      risk: ctx.risk,
      complianceSignals: ctx.complianceSignals,
      x402PurchasesToday: ctx.x402PurchasesToday,
    });
}

function onBill(event: BillDue, ctx: HeuristicContext): Proposal {
  const request: SpendRequest = { kind: "payout", bucket: "OPERATING", to: event.payee, amount: event.amount };
  const action: ProposedAction = { kind: "payout", bucket: "OPERATING", to: event.payee, amount: event.amount, ref: event.billId };
  return spendWith(request, action, ctx, `Bill ${event.billId} ${usdc(event.amount)} to ${event.payee}`);
}

function onRefund(event: RefundRequested, ctx: HeuristicContext): Proposal {
  const request: SpendRequest = { kind: "refund", bucket: "REFUND", to: event.customer, amount: event.amount };
  const action: ProposedAction = { kind: "refund", to: event.customer, amount: event.amount, ref: event.paymentRef };
  return spendWith(request, action, ctx, `Refund ${usdc(event.amount)} to ${event.customer}`);
}

function spendWith(request: SpendRequest, action: ProposedAction, ctx: HeuristicContext, label: string): Proposal {
  const verdict = evaluateWith(ctx)(request);
  if (verdict.decision === "allow") {
    return proposal(action, `${label}: within all caps and allowlisted.`, ["defer to next tick", "escalate to owner"], 0.9, verdict);
  }
  if (verdict.decision === "escalate") {
    return proposal(action, `${label}: needs owner approval (${verdict.reasons.join(", ")}).`, ["pay a partial amount under the threshold", "defer"], 0.7, verdict);
  }
  return onDenied(verdict, action, label);
}

function onDispute(event: DisputeOpened, _ctx: HeuristicContext): Proposal {
  const subject: ProposedAction = { kind: "refund", to: event.customer, amount: event.amount, ref: event.paymentRef };
  return proposal(
    { kind: "escalate", reason: "dispute opened", subject },
    `Dispute ${event.disputeId} for ${usdc(event.amount)}: disputes need evidence review, so a human decides refund vs contest.`,
    ["auto-refund from REFUND bucket", "contest automatically"],
    0.6,
  );
}

function onTick(_event: Tick, ctx: HeuristicContext): readonly Proposal[] {
  const out: Proposal[] = [];
  const { vault, policy } = ctx;
  if (vault.unallocated > 0n) {
    out.push(proposal({ kind: "allocate", amounts: allocate(vault.unallocated, policy) }, `Allocate ${usdc(vault.unallocated)} of unassigned inflow.`, ["leave unallocated"], 0.9));
  }
  if (vault.buckets.OPERATING < policy.minFloat) {
    out.push(proposal(
      { kind: "escalate", reason: "operating float below minimum" },
      `OPERATING ${usdc(vault.buckets.OPERATING)} is below the ${usdc(policy.minFloat)} floor; owner should top up or rebalance.`,
      ["pause outgoing bills", "wait for revenue"],
      0.85,
    ));
  }
  const gap = policy.yieldTarget - vault.yieldDeployed;
  const sweep = gap < vault.buckets.YIELD ? gap : vault.buckets.YIELD;
  if (vault.yieldEnabled && sweep > 0n) {
    out.push(proposal({ kind: "sweep_to_yield", amount: sweep }, `Sweep ${usdc(sweep)} toward the ${usdc(policy.yieldTarget)} yield target.`, ["keep YIELD liquid"], 0.8));
  }
  if (out.length === 0) {
    out.push(proposal({ kind: "defer", reason: "nothing to do" }, "Buckets balanced, float healthy, yield on target.", [], 1));
  }
  return out;
}
