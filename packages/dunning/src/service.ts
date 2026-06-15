import type { Result, SettleKitError } from "@settlekit/common";
import { conflict, notFound, ok } from "@settlekit/common";
import { recordAttempt, recover, startDunning } from "./dunning.js";
import type { DunningStore } from "./store.js";
import { DEFAULT_DUNNING_SCHEDULE, type DunningOutcome, type DunningSchedule, type DunningState } from "./types.js";

/**
 * Orchestrates dunning campaigns against a DunningStore. Enforces a single
 * active campaign per subscription and persists every immutable transition.
 */
export class DunningService {
  constructor(
    private readonly store: DunningStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async start(
    subscriptionId: string,
    schedule: DunningSchedule = DEFAULT_DUNNING_SCHEDULE,
  ): Promise<Result<DunningState, SettleKitError>> {
    const existing = await this.store.findBySubscription(subscriptionId);
    if (existing && existing.status === "active") {
      return { ok: false, error: conflict("an active dunning campaign already exists", { subscriptionId }) };
    }
    const started = startDunning(subscriptionId, schedule, this.now());
    if (!started.ok) return started;
    const saved = await this.store.save(started.value);
    return ok(saved);
  }

  async recordAttempt(
    subscriptionId: string,
    outcome: DunningOutcome,
    failureReason?: string,
  ): Promise<Result<DunningState, SettleKitError>> {
    const existing = await this.store.findBySubscription(subscriptionId);
    if (!existing) return { ok: false, error: notFound(`no dunning campaign for subscription ${subscriptionId}`) };
    const transitioned = recordAttempt(existing, outcome, { failureReason, now: this.now() });
    if (!transitioned.ok) return transitioned;
    const saved = await this.store.save(transitioned.value);
    return ok(saved);
  }

  async recover(subscriptionId: string): Promise<Result<DunningState, SettleKitError>> {
    const existing = await this.store.findBySubscription(subscriptionId);
    if (!existing) return { ok: false, error: notFound(`no dunning campaign for subscription ${subscriptionId}`) };
    const transitioned = recover(existing, this.now());
    if (!transitioned.ok) return transitioned;
    const saved = await this.store.save(transitioned.value);
    return ok(saved);
  }

  async get(subscriptionId: string): Promise<DunningState | undefined> {
    return this.store.findBySubscription(subscriptionId);
  }

  async listDue(now: Date = this.now()): Promise<DunningState[]> {
    return this.store.listDue(now);
  }

  async listActive(): Promise<DunningState[]> {
    return this.store.listActive();
  }
}
