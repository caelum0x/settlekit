/**
 * Internal pure helpers shared by the runner and retry logic. Everything here
 * is immutable: functions take a run snapshot and return a NEW snapshot, never
 * mutating the input. Not part of the public API.
 */

import { generateId, toIso } from "@settlekit/common";
import type {
  DeliveryActionRun,
  DeliveryActionStatus,
  DeliveryLog,
  DeliveryRun,
  DeliveryRunStatus,
} from "@settlekit/common";
import type { DeliveryLogger, RetryPolicy } from "./types.js";

/** Returns a new run with `actionRuns[index]` replaced by `next`. */
export function withActionRun(
  run: DeliveryRun,
  index: number,
  next: DeliveryActionRun,
): DeliveryRun {
  const actionRuns = run.actionRuns.map((ar, i) => (i === index ? next : ar));
  return { ...run, actionRuns };
}

/** Returns a new run with overridden status/completedAt. */
export function withRunStatus(
  run: DeliveryRun,
  status: DeliveryRunStatus,
  completedAt?: string,
): DeliveryRun {
  return {
    ...run,
    status,
    ...(completedAt !== undefined ? { completedAt } : {}),
  };
}

/**
 * Derive the terminal run status from its action runs.
 * - all succeeded                 -> "succeeded"
 * - none succeeded/rolled back    -> "failed"
 * - some succeeded/rolled back    -> "partially_failed"
 */
export function deriveRunStatus(actionRuns: ReadonlyArray<DeliveryActionRun>): DeliveryRunStatus {
  if (actionRuns.length === 0) return "succeeded";
  if (actionRuns.every((ar) => ar.status === "succeeded")) return "succeeded";
  const successLike = actionRuns.filter((ar) => ar.status === "succeeded" || ar.status === "rolled_back").length;
  if (successLike === 0) return "failed";
  return "partially_failed";
}

/** Build a fresh, immutable {@link DeliveryLog} entry and hand it to the logger. */
export function emitLog(
  logger: DeliveryLogger | undefined,
  params: {
    deliveryRunId: string;
    actionRunId: string;
    level: DeliveryLog["level"];
    message: string;
    now: () => Date;
  },
): void {
  if (!logger) return;
  const entry: DeliveryLog = {
    id: generateId("deliveryAction"),
    deliveryRunId: params.deliveryRunId,
    actionRunId: params.actionRunId,
    level: params.level,
    message: params.message,
    createdAt: toIso(params.now()),
  };
  logger.log(entry);
}

/** Extract a stable, human-readable message from an unknown thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** True if a thrown error explicitly opts out of retries (`retryable === false`). */
export function isNonRetryable(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "retryable" in err &&
    (err as { retryable?: unknown }).retryable === false
  );
}

/** Exponential backoff delay for the Nth retry (0-based), capped at maxDelayMs. */
export function backoffDelay(policy: RetryPolicy, retryIndex: number): number {
  const raw = policy.baseDelayMs * Math.pow(policy.factor, retryIndex);
  return Math.min(raw, policy.maxDelayMs);
}

/** Mark a single action-run snapshot with a new status (immutably). */
export function setActionStatus(
  actionRun: DeliveryActionRun,
  status: DeliveryActionStatus,
): DeliveryActionRun {
  return { ...actionRun, status };
}

/** Default real sleep used outside tests. */
export function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
