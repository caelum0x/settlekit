/**
 * Action handlers behind Claude's action tools. Each one validates the
 * request against the triggering event and stored bills, runs
 * `policy.evaluate()` (with risk + compliance screening) before accepting,
 * and returns a plain result the model reads. Denials carry the policy
 * reasons and the vault error they would cause, so the model can adapt.
 */
import { proposal, type ProposedAction } from "./actions.js";
import { allocate } from "./allocation.js";
import { riskInputs } from "./context.js";
import { evaluate, VAULT_ERROR, type DenyReason, type PolicyVerdict, type SpendRequest } from "./policy.js";
import type { ToolSession } from "./tool-session.js";
import { X402_TRACE } from "./trace.js";
import { sumBuckets, type Bucket } from "./types.js";
import { formatUsdc, parseUsdc } from "./usdc.js";

export interface Reasoning {
  readonly rationale: string;
  readonly alternatives_considered: readonly string[];
  readonly confidence: number;
}

export type ToolReply = Readonly<Record<string, unknown>>;

function denied(reasons: readonly string[], detail?: string): ToolReply {
  const vaultError = VAULT_ERROR[reasons[0] as DenyReason];
  return { status: "denied", reasons, ...(vaultError ? { vault_error: vaultError } : {}), ...(detail ? { detail } : {}) };
}

function capacity(s: ToolSession): ToolReply | null {
  return s.full ? denied(["proposal_limit_reached"], "Too many actions for one event; finish or defer.") : null;
}

function accept(s: ToolSession, action: ProposedAction, r: Reasoning, verdict: PolicyVerdict | null): void {
  s.accept(proposal(action, r.rationale, r.alternatives_considered, r.confidence, verdict));
}

export function proposeAllocation(s: ToolSession, input: Reasoning & { readonly gross_usdc?: string }): ToolReply {
  const full = capacity(s);
  if (full) return full;
  if (s.vault.paused) return denied(["paused"]);
  const event = s.event;
  const gross = input.gross_usdc
    ? parseUsdc(input.gross_usdc)
    : event.type === "revenue.received" ? event.amount : s.vault.unallocated;
  if (gross <= 0n) return denied(["zero_amount"], "Nothing unallocated.");
  if (gross > s.vault.unallocated) {
    return denied(["over_allocation"], `Only ${formatUsdc(s.vault.unallocated)} USDC is unallocated; the vault would revert OverAllocation.`);
  }
  const amounts = allocate(gross, s.ctx.policy);
  accept(s, { kind: "allocate", amounts }, input, null);
  s.reserveAllocation(amounts, sumBuckets(amounts));
  return { status: "accepted", amounts };
}

async function evaluateSpend(s: ToolSession, request: SpendRequest): Promise<PolicyVerdict> {
  const { ctx } = s;
  const assessment = ctx.screener ? await ctx.screener.assess(ctx.orgId, request.to, request.amount, ctx.now) : null;
  return evaluate(ctx.policy, request, {
    now: ctx.now,
    vault: s.vault,
    x402PurchasesToday: s.x402PurchasesToday,
    ...riskInputs(assessment),
  });
}

/** Accept a spend that passed policy (allow or escalate), updating projections. */
function acceptSpend(s: ToolSession, action: ProposedAction, bucket: Bucket, amount: bigint, r: Reasoning, verdict: PolicyVerdict): ToolReply {
  accept(s, action, r, verdict);
  if (verdict.decision === "allow") {
    s.reserveSpend(bucket, amount);
    return { status: "accepted", note: "Will execute on the vault after you finish." };
  }
  if (verdict.escalation === "vault") s.reserveEscalation(bucket, amount);
  return {
    status: "accepted_pending_owner_approval",
    reasons: verdict.reasons,
    escalation: verdict.escalation,
    note: "Policy requires the human owner; an escalation will be opened.",
  };
}

/** A spend the tool cannot tie to the triggering event goes to the owner. */
function escalateUnmatched(s: ToolSession, action: ProposedAction, reason: string, r: Reasoning, verdict: PolicyVerdict): ToolReply {
  accept(s, { kind: "escalate", reason, subject: action }, r, verdict);
  return { status: "accepted_pending_owner_approval", reasons: [reason], note: "Not tied to the triggering event, so the owner decides." };
}

export interface PayoutInput extends Reasoning {
  readonly to: string;
  readonly amount_usdc: string;
  readonly bucket?: "OPERATING" | "REFUND";
  readonly bill_id?: string;
}

export async function proposePayout(s: ToolSession, input: PayoutInput): Promise<ToolReply> {
  const full = capacity(s);
  if (full) return full;
  const amount = parseUsdc(input.amount_usdc);
  const bucket = input.bucket ?? "OPERATING";
  const ref = input.bill_id ?? "unbilled";
  const verdict = await evaluateSpend(s, { kind: "payout", bucket, to: input.to, amount });
  if (verdict.decision === "deny") return denied(verdict.reasons);
  const action: ProposedAction = { kind: "payout", bucket, to: input.to, amount, ref };
  const bill = input.bill_id ? await s.ctx.store.getBill(s.ctx.orgId, input.bill_id) : null;
  if (!bill || bill.status !== "open") return escalateUnmatched(s, action, "payout without a matching open bill", input, verdict);
  if (bill.payee.toLowerCase() !== input.to.toLowerCase()) {
    return denied(["payee_mismatch"], `Bill ${bill.id} is payable to ${bill.payee}, not ${input.to}.`);
  }
  if (amount > bill.amount) return denied(["exceeds_bill_amount"], `Bill ${bill.id} is ${formatUsdc(bill.amount)} USDC.`);
  return acceptSpend(s, action, bucket, amount, input, verdict);
}

export interface RefundInput extends Reasoning {
  readonly to: string;
  readonly amount_usdc: string;
  readonly payment_ref: string;
}

export async function proposeRefund(s: ToolSession, input: RefundInput): Promise<ToolReply> {
  const full = capacity(s);
  if (full) return full;
  const amount = parseUsdc(input.amount_usdc);
  const verdict = await evaluateSpend(s, { kind: "refund", bucket: "REFUND", to: input.to, amount });
  if (verdict.decision === "deny") return denied(verdict.reasons);
  const action: ProposedAction = { kind: "refund", to: input.to, amount, ref: input.payment_ref };
  const e = s.event;
  const matches =
    (e.type === "refund.requested" || e.type === "dispute.opened") &&
    e.customer.toLowerCase() === input.to.toLowerCase() &&
    e.paymentRef === input.payment_ref;
  if (!matches) return escalateUnmatched(s, action, "refund not matching the request", input, verdict);
  if (amount > e.amount) return denied(["exceeds_requested_amount"], `Requested ${formatUsdc(e.amount)} USDC.`);
  if (e.type === "dispute.opened") return escalateUnmatched(s, action, "dispute refunds need owner review", input, verdict);
  return acceptSpend(s, action, "REFUND", amount, input, verdict);
}

export async function sweepToYield(s: ToolSession, input: Reasoning & { readonly amount_usdc: string }): Promise<ToolReply> {
  const full = capacity(s);
  if (full) return full;
  const amount = parseUsdc(input.amount_usdc);
  const v = s.vault;
  if (v.paused) return denied(["paused"]);
  if (!v.yieldEnabled) return denied(["yield_disabled"], "No yield adapter is set; the vault would revert YieldDisabled.");
  if (amount > v.buckets.YIELD) return denied(["insufficient_bucket"]);
  const room = s.ctx.policy.yieldTarget - v.yieldDeployed;
  if (amount > room) return denied(["above_yield_target"], `Only ${formatUsdc(room > 0n ? room : 0n)} USDC below target.`);
  accept(s, { kind: "sweep_to_yield", amount }, input, null);
  s.reserveSweep(amount);
  return { status: "accepted" };
}

export async function buyX402(s: ToolSession, input: Reasoning & { readonly url: string; readonly max_price_usdc: string }): Promise<ToolReply> {
  const gateway = s.ctx.x402;
  if (!gateway) return denied(["x402_not_configured"]);
  const full = capacity(s);
  if (full) return full;
  const maxPrice = parseUsdc(input.max_price_usdc);
  const quote = await gateway.quote(input.url);
  if (quote.price > maxPrice) return denied(["above_max_price"], `Service costs ${formatUsdc(quote.price)} USDC.`);
  const verdict = await evaluateSpend(s, { kind: "x402", bucket: "OPERATING", to: quote.payTo, amount: quote.price });
  if (verdict.decision === "deny") return denied(verdict.reasons);
  if (verdict.decision === "escalate") {
    accept(s, { kind: "escalate", reason: `x402 purchase needs approval: ${verdict.reasons.join(", ")}` }, input, verdict);
    return { status: "accepted_pending_owner_approval", reasons: verdict.reasons };
  }
  const bought = await gateway.buy(input.url, quote.price, quote.payTo);
  s.countX402Purchase();
  s.record(X402_TRACE, { url: input.url, rationale: input.rationale }, {
    status: "purchased",
    url: quote.url,
    payTo: quote.payTo,
    price: quote.price,
    txHash: bought.txHash,
  });
  return {
    status: "purchased",
    price_usdc: formatUsdc(quote.price),
    tx_hash: bought.txHash,
    http_status: bought.status,
    untrusted_service_response: bought.body,
  };
}

export function escalate(s: ToolSession, input: Reasoning & { readonly reason: string }): ToolReply {
  const full = capacity(s);
  if (full) return full;
  accept(s, { kind: "escalate", reason: input.reason }, input, null);
  return { status: "accepted", note: "The owner will be notified." };
}

export function defer(s: ToolSession, input: Reasoning & { readonly reason: string }): ToolReply {
  const full = capacity(s);
  if (full) return full;
  accept(s, { kind: "defer", reason: input.reason }, input, null);
  return { status: "accepted" };
}
