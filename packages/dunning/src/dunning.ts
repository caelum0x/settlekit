import type { Result, SettleKitError } from "@settlekit/common";
import { addDays, conflict, err, ok, toIso, validationError } from "@settlekit/common";
import {
  DEFAULT_DUNNING_SCHEDULE,
  type DunningAttemptRecord,
  type DunningOutcome,
  type DunningSchedule,
  type DunningState,
} from "./types.js";

/** Total number of attempts a schedule permits. */
export function totalAttempts(schedule: DunningSchedule): number {
  return schedule.offsetsDays.length;
}

/** Compute the ISO time of attempt `index` (0-based) relative to `start`. */
function attemptTime(start: Date, schedule: DunningSchedule, index: number): string | undefined {
  const offset = schedule.offsetsDays[index];
  if (offset === undefined) return undefined;
  return toIso(addDays(start, offset));
}

/** Validate that a schedule is non-empty and strictly ascending. */
export function validateSchedule(schedule: DunningSchedule): Result<DunningSchedule, SettleKitError> {
  const { offsetsDays } = schedule;
  if (offsetsDays.length === 0) {
    return err(validationError("dunning schedule must have at least one attempt"));
  }
  for (let i = 0; i < offsetsDays.length; i++) {
    const current = offsetsDays[i];
    if (current === undefined || current < 0 || !Number.isInteger(current)) {
      return err(validationError("dunning offsets must be non-negative integers", { offsetsDays }));
    }
    if (i > 0) {
      const prev = offsetsDays[i - 1];
      if (prev !== undefined && current <= prev) {
        return err(validationError("dunning offsets must be strictly ascending", { offsetsDays }));
      }
    }
  }
  return ok(schedule);
}

/**
 * Begin a dunning campaign for a subscription whose latest renewal failed.
 * The first attempt is scheduled at the schedule's first offset from `now`.
 */
export function startDunning(
  subscriptionId: string,
  schedule: DunningSchedule = DEFAULT_DUNNING_SCHEDULE,
  now: Date = new Date(),
): Result<DunningState, SettleKitError> {
  const valid = validateSchedule(schedule);
  if (!valid.ok) return valid;

  const timestamp = toIso(now);
  const state: DunningState = {
    subscriptionId,
    attempt: 0,
    schedule,
    nextAttemptAt: attemptTime(now, schedule, 0),
    status: "active",
    history: [],
    startedAt: timestamp,
    updatedAt: timestamp,
  };
  return ok(state);
}

/** True when all scheduled attempts have been used without recovery. */
export function isExhausted(state: DunningState): boolean {
  return state.status === "exhausted";
}

/** Attempts remaining before the campaign is exhausted. */
export function attemptsRemaining(state: DunningState): number {
  return Math.max(0, totalAttempts(state.schedule) - state.attempt);
}

/**
 * Record the outcome of the next due attempt. A success transitions the
 * campaign to `recovered`; a failure advances to the next scheduled offset or,
 * if none remain, to `exhausted`. Returns a conflict if the campaign is closed.
 */
export function recordAttempt(
  state: DunningState,
  outcome: DunningOutcome,
  options: { failureReason?: string; now?: Date } = {},
): Result<DunningState, SettleKitError> {
  if (state.status !== "active") {
    return err(conflict(`cannot record attempt on a ${state.status} dunning campaign`, {
      subscriptionId: state.subscriptionId,
    }));
  }

  const now = options.now ?? new Date();
  const timestamp = toIso(now);
  const attemptNumber = state.attempt + 1;
  const record: DunningAttemptRecord = {
    attempt: attemptNumber,
    outcome,
    at: timestamp,
    ...(outcome === "failed" && options.failureReason ? { failureReason: options.failureReason } : {}),
  };
  const history = [...state.history, record];

  if (outcome === "succeeded") {
    return ok({
      ...state,
      attempt: attemptNumber,
      status: "recovered",
      nextAttemptAt: undefined,
      history,
      updatedAt: timestamp,
    });
  }

  const hasMore = attemptNumber < totalAttempts(state.schedule);
  if (!hasMore) {
    return ok({
      ...state,
      attempt: attemptNumber,
      status: "exhausted",
      nextAttemptAt: undefined,
      history,
      updatedAt: timestamp,
    });
  }

  const start = new Date(state.startedAt);
  return ok({
    ...state,
    attempt: attemptNumber,
    status: "active",
    nextAttemptAt: attemptTime(start, state.schedule, attemptNumber),
    history,
    updatedAt: timestamp,
  });
}

/**
 * Force a campaign into the `recovered` state (e.g. the customer paid out of
 * band). Idempotent if already recovered; conflicts if exhausted.
 */
export function recover(state: DunningState, now: Date = new Date()): Result<DunningState, SettleKitError> {
  if (state.status === "recovered") return ok(state);
  if (state.status === "exhausted") {
    return err(conflict("cannot recover an exhausted dunning campaign", { subscriptionId: state.subscriptionId }));
  }
  return ok({ ...state, status: "recovered", nextAttemptAt: undefined, updatedAt: toIso(now) });
}

/** True when an attempt is due at or before `now`. */
export function isAttemptDue(state: DunningState, now: Date = new Date()): boolean {
  if (state.status !== "active" || state.nextAttemptAt === undefined) return false;
  return new Date(state.nextAttemptAt).getTime() <= now.getTime();
}
