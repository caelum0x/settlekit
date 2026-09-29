/**
 * OperatorService — handles one business event end to end.
 *
 *   event -> engine (Claude or heuristic) -> commitment hash -> vault
 *   execution / escalations -> one hash-chained DecisionRecord
 *
 * The commitment (`anchorHash`) covers the agent's reasoning and tool trace
 * and is what OperatorVault anchors in `DecisionAnchored`, so the on-chain
 * log proves the reasoning preceded the money movement. Owner approvals,
 * rejections and expiries are recorded as their own decisions.
 */
import { randomUUID } from "node:crypto";
import type { Proposal } from "./actions.js";
import type { CounterpartyScreener, DecisionEngine, EngineContext, EngineDecision, PaymentHistory, PolicySource, X402Gateway } from "./context.js";
import { chainDecision, commitmentHash, digest, type DecisionInput, type DecisionRecord, type ToolCallRecord } from "./decision-log.js";
import { isExpired, type Escalation, type EscalationQueue } from "./escalation.js";
import { aggregateOutcome, carryOut } from "./execution.js";
import type { OperatorEvent } from "./events.js";
import type { OperatorExecutor, OwnerExecutor } from "./executor.js";
import { ChainConflictError, type OperatorStore } from "./store.js";
import { eventTrace, executeTrace, type ExecutionResult } from "./trace.js";

export interface OperatorServiceDeps {
  readonly store: OperatorStore;
  readonly executor: OperatorExecutor;
  readonly owner?: OwnerExecutor;
  readonly policy: PolicySource;
  readonly engine: DecisionEngine;
  readonly escalations: EscalationQueue;
  readonly screener?: CounterpartyScreener;
  readonly history?: PaymentHistory;
  readonly x402?: X402Gateway;
  readonly now?: () => Date;
  readonly newId?: (prefix: string) => string;
}

export class OperatorServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorServiceError";
  }
}

const APPEND_ATTEMPTS = 3;

function summarize(proposals: readonly Proposal[]): Pick<DecisionInput, "policyVerdict" | "rationale" | "alternatives" | "confidence"> {
  const primary = proposals.find((p) => p.verdict !== null) ?? proposals[0];
  return {
    policyVerdict: primary?.verdict ?? null,
    rationale: proposals.map((p) => p.rationale).join(" "),
    alternatives: [...new Set(proposals.flatMap((p) => p.alternativesConsidered))],
    confidence: proposals.length > 0 ? Math.min(...proposals.map((p) => p.confidence)) : 0,
  };
}

export class OperatorService {
  private readonly now: () => Date;
  private readonly newId: (prefix: string) => string;

  constructor(private readonly deps: OperatorServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? ((prefix) => `${prefix}_${randomUUID()}`);
  }

  get store(): OperatorStore {
    return this.deps.store;
  }

  get escalations(): EscalationQueue {
    return this.deps.escalations;
  }

  /** Decide on and act upon one event; returns the recorded decision. */
  async handle(event: OperatorEvent): Promise<DecisionRecord> {
    return this.handleWith(event, this.deps.engine);
  }

  /** Handle an event with a specific engine (e.g. deterministic intake rules). */
  async handleWith(event: OperatorEvent, engine: DecisionEngine): Promise<DecisionRecord> {
    const started = this.now();
    const ctx = await this.engineContext(event.orgId, started);
    const decision = await engine.decide(event, ctx);
    const draft = this.draft(event, decision, started);
    const anchorHash = commitmentHash(draft);
    const results = await this.execute(event.orgId, draft.id, anchorHash, decision.proposals);
    await this.updateBill(event, results);
    return this.record({ ...draft, ...this.withResults(draft.toolCalls, decision.proposals, results), anchorHash }, started);
  }

  /** Owner approves an escalation: executes it (vault approve or payout) and records it. */
  async approve(orgId: string, escalationId: string, by: string): Promise<DecisionRecord> {
    const escalation = await this.pending(orgId, escalationId);
    const started = this.now();
    const subject = escalation.proposal.action.kind === "escalate" ? escalation.proposal.action.subject : escalation.proposal.action;
    const draft = this.ownerDraft(orgId, escalation, "approve", by, `Owner ${by} approved escalation ${escalation.id}.`, started);
    const anchorHash = await this.anchorFor(escalation, draft);
    let result: ExecutionResult;
    if (escalation.vaultEscalationId !== undefined) {
      result = await this.ownerVaultCall(() => this.requireOwner().approve(escalation.vaultEscalationId as number));
    } else if (subject) {
      result = await this.executeApproved(orgId, draft.id, anchorHash, { ...escalation.proposal, action: subject, verdict: null });
    } else {
      result = { status: "executed" };
    }
    if (result.status === "executed") {
      await this.deps.escalations.approve(orgId, escalation.id, by);
      await this.resolveBill(orgId, subject, "paid");
    }
    const trace = subject ? [executeTrace(subject, result)] : [];
    return this.record({ ...draft, toolCalls: [...draft.toolCalls, ...trace], outcome: aggregateOutcome([result]), ...this.txOf([result]), anchorHash }, started);
  }

  /** Owner rejects an escalation; a vault-held escalation is released on-chain. */
  async reject(orgId: string, escalationId: string, by: string, reason: string): Promise<DecisionRecord> {
    const escalation = await this.pending(orgId, escalationId);
    const started = this.now();
    const draft = this.ownerDraft(orgId, escalation, "reject", by, `Owner ${by} rejected escalation ${escalation.id}: ${reason}`, started);
    const anchorHash = await this.anchorFor(escalation, draft);
    const result = escalation.vaultEscalationId !== undefined
      ? await this.ownerVaultCall(() => this.requireOwner().reject(escalation.vaultEscalationId as number))
      : ({ status: "denied" } as ExecutionResult);
    const trace = { name: "owner_result", input: { escalationId: escalation.id }, output: result };
    if (result.status === "failed" || result.status === "blocked_on_chain") {
      return this.record({ ...draft, outcome: "failed", toolCalls: [...draft.toolCalls, trace], anchorHash }, started);
    }
    await this.deps.escalations.reject(orgId, escalation.id, by, reason);
    await this.resolveBill(orgId, escalation.proposal.action.kind === "escalate" ? escalation.proposal.action.subject : escalation.proposal.action, "rejected");
    return this.record({ ...draft, outcome: "denied", toolCalls: [...draft.toolCalls, trace], ...this.txOf([result]), anchorHash }, started);
  }

  /** Expire stale escalations (72h) and record each as an auto-rejection. */
  async expireStale(orgId: string): Promise<readonly DecisionRecord[]> {
    const expired = await this.deps.escalations.expireStale(orgId);
    const out: DecisionRecord[] = [];
    for (const e of expired) {
      const started = this.now();
      const draft = this.ownerDraft(orgId, e, "expire", "system", e.resolution ?? "expired", started);
      const result = e.vaultEscalationId !== undefined && this.deps.owner
        ? await this.ownerVaultCall(() => (this.deps.owner as OwnerExecutor).expire(e.vaultEscalationId as number))
        : ({ status: "denied" } as ExecutionResult);
      const subject = e.proposal.action.kind === "escalate" ? e.proposal.action.subject : e.proposal.action;
      await this.resolveBill(orgId, subject, "rejected");
      const trace = { name: "owner_result", input: { escalationId: e.id }, output: result };
      const outcome = result.status === "failed" || result.status === "blocked_on_chain" ? "failed" : "denied";
      out.push(await this.record({ ...draft, outcome, toolCalls: [...draft.toolCalls, trace], ...this.txOf([result]), anchorHash: await this.anchorFor(e, draft) }, started));
    }
    return out;
  }

  // ---------------------------------------------------------------- internals

  private async engineContext(orgId: string, now: Date): Promise<EngineContext> {
    const [policy, vault] = await Promise.all([this.deps.policy.get(orgId), this.deps.executor.snapshot()]);
    const x402PurchasesToday = this.deps.x402 ? await this.deps.x402.purchasesToday(orgId, now) : 0;
    return {
      orgId,
      policy,
      vault,
      now,
      store: this.deps.store,
      screener: this.deps.screener,
      history: this.deps.history,
      x402: this.deps.x402,
      x402PurchasesToday,
    };
  }

  private draft(event: OperatorEvent, d: EngineDecision, at: Date): DecisionInput {
    return {
      id: this.newId("dec"),
      orgId: event.orgId,
      eventRef: event.id,
      model: d.model,
      inputsDigest: d.inputsDigest,
      toolCalls: [eventTrace(event), ...d.toolCalls],
      ...summarize(d.proposals),
      outcome: "deferred",
      ...(d.usage ? { usage: d.usage } : {}),
      createdAt: at.toISOString(),
    };
  }

  private ownerDraft(orgId: string, e: Escalation, verb: string, by: string, rationale: string, at: Date): DecisionInput {
    return {
      id: this.newId("dec"),
      orgId,
      eventRef: `escalation:${e.id}`,
      model: verb === "expire" ? "system" : "owner",
      inputsDigest: digest({ escalation: e.id, decisionId: e.decisionId, proposal: e.proposal, reasons: e.reasons }),
      toolCalls: [{ name: `owner_${verb}`, input: { escalationId: e.id, decisionId: e.decisionId, by } }],
      policyVerdict: e.proposal.verdict,
      rationale,
      alternatives: verb === "approve" ? ["reject"] : ["approve"],
      confidence: 1,
      outcome: "deferred",
      createdAt: at.toISOString(),
    };
  }

  private async execute(orgId: string, decisionId: string, anchorHash: string, proposals: readonly Proposal[]): Promise<readonly ExecutionResult[]> {
    const ctx = { orgId, decisionId, anchorHash, executor: this.deps.executor, escalations: this.deps.escalations, newId: () => this.newId("esc") };
    const results: ExecutionResult[] = [];
    for (const p of proposals) results.push(await carryOut(ctx, p));
    return results;
  }

  /** Execute an owner-approved subject; a vault re-escalation is approved at once. */
  private async executeApproved(orgId: string, decisionId: string, anchorHash: string, p: Proposal): Promise<ExecutionResult> {
    const [result] = await this.execute(orgId, decisionId, anchorHash, [p]);
    if (!result || result.status !== "escalated" || result.vaultEscalationId === undefined) return result ?? { status: "failed" };
    const approved = await this.ownerVaultCall(() => this.requireOwner().approve(result.vaultEscalationId as number));
    if (result.escalationId) await this.deps.escalations.approve(orgId, result.escalationId, "owner").catch(() => undefined);
    return approved;
  }

  private withResults(base: readonly ToolCallRecord[], proposals: readonly Proposal[], results: readonly ExecutionResult[]): Pick<DecisionInput, "toolCalls" | "outcome" | "txHash" | "txHashes"> {
    const executions = proposals.map((p, i) => executeTrace(p.action, results[i] as ExecutionResult));
    return { toolCalls: [...base, ...executions], outcome: aggregateOutcome(results), ...this.txOf(results) };
  }

  private txOf(results: readonly ExecutionResult[]): Pick<DecisionInput, "txHash" | "txHashes"> {
    const hashes = results.flatMap((r) => (r.txHash ? [r.txHash] : []));
    return hashes.length > 0 ? { txHash: hashes[0], txHashes: hashes } : {};
  }

  private async ownerVaultCall(call: () => Promise<{ readonly txHash: string }>): Promise<ExecutionResult> {
    try {
      const tx = await call();
      return { status: "executed", txHash: tx.txHash };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (error instanceof Error && error.name === "VaultError" && typeof code === "string") return { status: "blocked_on_chain", error: code };
      return { status: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * The hash the vault anchors for an owner action: a vault-held escalation
   * re-anchors the original decision's hash; otherwise this record's own.
   */
  private async anchorFor(e: Escalation, draft: DecisionInput): Promise<string> {
    if (e.vaultEscalationId === undefined) return commitmentHash(draft);
    const original = await this.deps.store.getDecision(e.orgId, e.decisionId);
    return original?.anchorHash ?? commitmentHash(draft);
  }

  private requireOwner(): OwnerExecutor {
    if (!this.deps.owner) throw new OperatorServiceError("no owner executor configured for vault escalations");
    return this.deps.owner;
  }

  private async pending(orgId: string, id: string): Promise<Escalation> {
    const e = await this.deps.store.getEscalation(orgId, id);
    if (!e) throw new OperatorServiceError(`escalation ${id} not found`);
    if (e.status !== "pending") throw new OperatorServiceError(`escalation ${id} is ${e.status}`);
    if (isExpired(e, this.now())) throw new OperatorServiceError(`escalation ${id} expired at ${e.expiresAt}`);
    return e;
  }

  private async updateBill(event: OperatorEvent, results: readonly ExecutionResult[]): Promise<void> {
    if (event.type !== "bill.due") return;
    const bill = await this.deps.store.getBill(event.orgId, event.billId);
    if (!bill || bill.status !== "open") return;
    const outcome = aggregateOutcome(results);
    const status = outcome === "executed" ? "paid" : outcome === "escalated" ? "escalated" : outcome === "denied" ? "rejected" : null;
    if (status) await this.deps.store.saveBill({ ...bill, status });
  }

  /** Close an escalated bill once the owner resolves its payout. */
  private async resolveBill(orgId: string, action: Proposal["action"] | undefined, status: "paid" | "rejected"): Promise<void> {
    if (!action || action.kind !== "payout") return;
    const bill = await this.deps.store.getBill(orgId, action.ref);
    if (bill && bill.status === "escalated") await this.deps.store.saveBill({ ...bill, status });
  }

  /** Chain onto the org head and append, re-linking on a concurrent append. */
  private async record(input: DecisionInput, started: Date): Promise<DecisionRecord> {
    const full: DecisionInput = { ...input, latencyMs: Math.max(0, this.now().getTime() - started.getTime()) };
    for (let attempt = 1; ; attempt++) {
      const head = await this.deps.store.headDecision(full.orgId);
      try {
        return await this.deps.store.appendDecision(chainDecision(head, full));
      } catch (error) {
        if (!(error instanceof ChainConflictError) || attempt >= APPEND_ATTEMPTS) throw error;
      }
    }
  }
}

