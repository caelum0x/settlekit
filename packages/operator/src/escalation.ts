/**
 * Escalations — decisions that need the human owner.
 *
 * Pure lifecycle functions (open / approve / reject / expire) return new
 * escalation values; `EscalationQueue` persists them through an
 * `OperatorStore` and fires an optional notifier. Pending escalations expire
 * after 72 hours and are recorded as rejected-by-expiry with a logged reason,
 * matching OperatorVault's `ESCALATION_TTL`.
 */
import type { Proposal } from "./actions.js";
import type { OperatorStore } from "./store.js";

export const ESCALATION_TTL_MS = 72 * 60 * 60 * 1000;

export type EscalationStatus = "pending" | "approved" | "rejected" | "expired";

export interface Escalation {
  readonly id: string;
  readonly orgId: string;
  readonly decisionId: string;
  readonly proposal: Proposal;
  readonly reasons: readonly string[];
  readonly status: EscalationStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
  /** Id of the matching on-chain Pending escalation, when the vault holds it. */
  readonly vaultEscalationId?: number;
  readonly resolvedAt?: string;
  readonly resolvedBy?: string;
  readonly resolution?: string;
}

export interface OpenEscalationInput {
  readonly id: string;
  readonly orgId: string;
  readonly decisionId: string;
  readonly proposal: Proposal;
  readonly reasons: readonly string[];
  readonly vaultEscalationId?: number;
}

export class EscalationStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EscalationStateError";
  }
}

export function openEscalation(input: OpenEscalationInput, now: Date): Escalation {
  return Object.freeze({
    ...input,
    reasons: [...input.reasons],
    status: "pending",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ESCALATION_TTL_MS).toISOString(),
  });
}

export function isExpired(e: Escalation, now: Date): boolean {
  return now.getTime() > Date.parse(e.expiresAt);
}

function requireActionable(e: Escalation, now: Date): void {
  if (e.status !== "pending") throw new EscalationStateError(`escalation ${e.id} is ${e.status}`);
  if (isExpired(e, now)) throw new EscalationStateError(`escalation ${e.id} expired at ${e.expiresAt}`);
}

export function approveEscalation(e: Escalation, by: string, now: Date, note = "approved by owner"): Escalation {
  requireActionable(e, now);
  return Object.freeze({ ...e, status: "approved", resolvedAt: now.toISOString(), resolvedBy: by, resolution: note });
}

export function rejectEscalation(e: Escalation, by: string, reason: string, now: Date): Escalation {
  requireActionable(e, now);
  if (reason.trim().length === 0) throw new EscalationStateError("a rejection reason is required");
  return Object.freeze({ ...e, status: "rejected", resolvedAt: now.toISOString(), resolvedBy: by, resolution: reason });
}

export function expireEscalation(e: Escalation, now: Date): Escalation {
  if (e.status !== "pending") throw new EscalationStateError(`escalation ${e.id} is ${e.status}`);
  if (!isExpired(e, now)) throw new EscalationStateError(`escalation ${e.id} has not expired`);
  return Object.freeze({
    ...e,
    status: "expired",
    resolvedAt: now.toISOString(),
    resolvedBy: "system",
    resolution: "auto-rejected: no owner decision within 72h",
  });
}

export type EscalationEvent = "opened" | "approved" | "rejected" | "expired";
export type EscalationNotifier = (escalation: Escalation, event: EscalationEvent) => Promise<void>;

export interface EscalationQueueOptions {
  readonly now?: () => Date;
  readonly notify?: EscalationNotifier;
}

/** Store-backed escalation queue. State is saved before notifying. */
export class EscalationQueue {
  private readonly now: () => Date;
  private readonly notify?: EscalationNotifier;

  constructor(private readonly store: OperatorStore, options: EscalationQueueOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.notify = options.notify;
  }

  async open(input: OpenEscalationInput): Promise<Escalation> {
    return this.persist(openEscalation(input, this.now()), "opened");
  }

  async approve(orgId: string, id: string, by: string): Promise<Escalation> {
    return this.persist(approveEscalation(await this.load(orgId, id), by, this.now()), "approved");
  }

  async reject(orgId: string, id: string, by: string, reason: string): Promise<Escalation> {
    return this.persist(rejectEscalation(await this.load(orgId, id), by, reason, this.now()), "rejected");
  }

  async listPending(orgId: string): Promise<readonly Escalation[]> {
    return this.store.listEscalations(orgId, "pending");
  }

  /** Expire every stale pending escalation for an org; returns those expired. */
  async expireStale(orgId: string): Promise<readonly Escalation[]> {
    const now = this.now();
    const stale = (await this.listPending(orgId)).filter((e) => isExpired(e, now));
    const expired: Escalation[] = [];
    for (const e of stale) {
      expired.push(await this.persist(expireEscalation(e, now), "expired"));
    }
    return expired;
  }

  private async load(orgId: string, id: string): Promise<Escalation> {
    const found = await this.store.getEscalation(orgId, id);
    if (!found) throw new EscalationStateError(`escalation ${id} not found`);
    return found;
  }

  private async persist(e: Escalation, event: EscalationEvent): Promise<Escalation> {
    const saved = await this.store.saveEscalation(e);
    if (this.notify) await this.notify(saved, event);
    return saved;
  }
}
