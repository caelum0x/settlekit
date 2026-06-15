/**
 * The delivery action engine (plan §21).
 *
 * After a payment confirms, {@link DeliveryRunner.run} executes the ordered
 * actions of a {@link DeliveryPlan}. Each action is attempted up to
 * `maxAttempts` times with exponential backoff. On an unrecoverable failure the
 * run is marked `partially_failed` (if some actions already succeeded) or
 * `failed` (if none did), and every already-succeeded action is rolled back
 * best-effort in reverse order.
 *
 * All run objects are immutable: every state transition returns a NEW
 * {@link DeliveryRun} snapshot. The runner emits {@link DeliveryLog} entries via
 * the injected logger.
 */

import { generateId, toIso } from "@settlekit/common";
import type {
  DeliveryAction,
  DeliveryActionRun,
  DeliveryPlan,
  DeliveryRun,
} from "@settlekit/common";
import { HandlerRegistry } from "./registry.js";
import {
  DEFAULT_RETRY_POLICY,
  type DeliveryContext,
  type DeliveryLogger,
  type DeliveryRunnerOptions,
  type RetryPolicy,
} from "./types.js";
import {
  backoffDelay,
  deriveRunStatus,
  emitLog,
  errorMessage,
  isNonRetryable,
  realSleep,
  setActionStatus,
  withActionRun,
  withRunStatus,
} from "./internal.js";

/** Identity needed to create a run; the rest is sourced from the plan. */
export interface DeliveryRunInput {
  paymentId: string;
  customerId: string;
}

export class DeliveryRunner {
  private readonly registry: HandlerRegistry;
  private readonly logger?: DeliveryLogger;
  private readonly retry: RetryPolicy;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(registry: HandlerRegistry, options: DeliveryRunnerOptions = {}) {
    this.registry = registry;
    this.logger = options.logger;
    this.retry = { ...DEFAULT_RETRY_POLICY, ...options.retry };
    this.sleep = options.sleep ?? realSleep;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Execute every action of `plan` in order. Returns the final, immutable
   * {@link DeliveryRun} snapshot.
   */
  async run(plan: DeliveryPlan, ctx: DeliveryContext, input: DeliveryRunInput): Promise<DeliveryRun> {
    const initial = this.createRun(plan, ctx, input);
    return this.executePending(initial, ctx);
  }

  /** Build the initial pending run snapshot from the plan's actions. */
  createRun(plan: DeliveryPlan, ctx: DeliveryContext, input: DeliveryRunInput): DeliveryRun {
    const actionRuns: DeliveryActionRun[] = plan.actions.map((action) => ({
      id: generateId("deliveryAction"),
      action,
      status: "pending",
      attempts: 0,
    }));
    return {
      id: generateId("deliveryRun"),
      organizationId: plan.organizationId,
      paymentId: input.paymentId,
      customerId: input.customerId,
      deliveryPlanId: plan.id,
      status: "pending",
      actionRuns,
      createdAt: toIso(this.now()),
    };
  }

  /**
   * Run every action that is not already `succeeded`/`rolled_back`. Shared by
   * {@link run} and the retry path so re-runs reuse the exact execution logic.
   */
  async executePending(run: DeliveryRun, ctx: DeliveryContext): Promise<DeliveryRun> {
    let current = withRunStatus(run, "running");

    for (let i = 0; i < current.actionRuns.length; i++) {
      const actionRun = current.actionRuns[i];
      if (!actionRun) continue;
      if (actionRun.status === "succeeded" || actionRun.status === "rolled_back") {
        continue;
      }

      const result = await this.runAction(current, i, ctx);
      current = result.run;

      if (!result.succeeded) {
        // Unrecoverable: roll back everything that succeeded so far, then stop.
        current = await this.rollbackSucceeded(current, ctx);
        const status = deriveRunStatus(current.actionRuns);
        return withRunStatus(current, status, toIso(this.now()));
      }
    }

    const status = deriveRunStatus(current.actionRuns);
    return withRunStatus(current, status, toIso(this.now()));
  }

  /**
   * Execute a single action with retry/backoff. Returns the updated run plus
   * whether the action ultimately succeeded.
   */
  private async runAction(
    run: DeliveryRun,
    index: number,
    ctx: DeliveryContext,
  ): Promise<{ run: DeliveryRun; succeeded: boolean }> {
    const original = run.actionRuns[index];
    if (!original) return { run, succeeded: false };

    const handler = this.registry.get(original.action.type);
    let current = run;
    let actionRun = setActionStatus(original, "running");
    current = withActionRun(current, index, actionRun);

    if (!handler) {
      const message = `No handler registered for action "${original.action.type}"`;
      actionRun = {
        ...actionRun,
        status: "failed",
        attempts: actionRun.attempts,
        lastError: message,
      };
      current = withActionRun(current, index, actionRun);
      this.emit(current.id, actionRun.id, "error", message);
      return { run: current, succeeded: false };
    }

    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt++) {
      try {
        const output = await handler.execute(original.action, ctx);
        actionRun = {
          id: actionRun.id,
          action: actionRun.action,
          status: "succeeded",
          attempts: attempt,
          output,
        };
        current = withActionRun(current, index, actionRun);
        this.emit(
          current.id,
          actionRun.id,
          "info",
          `Action "${original.action.type}" succeeded on attempt ${attempt}`,
        );
        return { run: current, succeeded: true };
      } catch (err) {
        const message = errorMessage(err);
        actionRun = {
          ...actionRun,
          status: "failed",
          attempts: attempt,
          lastError: message,
        };
        current = withActionRun(current, index, actionRun);

        const exhausted = attempt >= this.retry.maxAttempts;
        const giveUp = exhausted || isNonRetryable(err);
        this.emit(
          current.id,
          actionRun.id,
          giveUp ? "error" : "warn",
          `Action "${original.action.type}" failed on attempt ${attempt}: ${message}`,
        );

        if (giveUp) {
          return { run: current, succeeded: false };
        }
        await this.sleep(backoffDelay(this.retry, attempt - 1));
      }
    }

    return { run: current, succeeded: false };
  }

  /**
   * Best-effort rollback of every succeeded action, in reverse order. A failing
   * rollback is logged but never aborts the remaining rollbacks. Successfully
   * rolled-back actions transition to `rolled_back`; the rest stay `succeeded`.
   */
  async rollbackSucceeded(run: DeliveryRun, ctx: DeliveryContext): Promise<DeliveryRun> {
    let current = run;
    for (let i = current.actionRuns.length - 1; i >= 0; i--) {
      const actionRun = current.actionRuns[i];
      if (!actionRun || actionRun.status !== "succeeded") continue;

      const handler = this.registry.get(actionRun.action.type);
      if (!handler?.rollback) {
        this.emit(
          current.id,
          actionRun.id,
          "warn",
          `No rollback for action "${actionRun.action.type}"; leaving as succeeded`,
        );
        continue;
      }

      try {
        await handler.rollback(actionRun.action, actionRun.output ?? {}, ctx);
        current = withActionRun(current, i, setActionStatus(actionRun, "rolled_back"));
        this.emit(current.id, actionRun.id, "info", `Rolled back action "${actionRun.action.type}"`);
      } catch (err) {
        const message = errorMessage(err);
        current = withActionRun(current, i, { ...actionRun, lastError: message });
        this.emit(
          current.id,
          actionRun.id,
          "error",
          `Rollback of action "${actionRun.action.type}" failed: ${message}`,
        );
      }
    }
    return current;
  }

  private emit(
    deliveryRunId: string,
    actionRunId: string,
    level: "info" | "warn" | "error",
    message: string,
  ): void {
    emitLog(this.logger, { deliveryRunId, actionRunId, level, message, now: this.now });
  }
}

/** Re-export for callers that only need the action union narrowing here. */
export type { DeliveryAction };
