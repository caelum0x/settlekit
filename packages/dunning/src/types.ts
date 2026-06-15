import type { IsoTimestamp } from "@settlekit/common";

/** Outcome of a single dunning retry attempt against the payment provider. */
export type DunningOutcome = "succeeded" | "failed";

/** Lifecycle of a dunning campaign for one subscription. */
export type DunningStatus = "active" | "recovered" | "exhausted";

/**
 * A dunning schedule defines the offsets (in days from campaign start) at which
 * each retry attempt should be made. The default is +0/+1d/+3d/+7d (4 attempts).
 */
export interface DunningSchedule {
  /** Day offsets from the campaign start, ascending. Length = total attempts. */
  offsetsDays: readonly number[];
}

/** Default dunning cadence: retry immediately, then after 1, 3 and 7 days. */
export const DEFAULT_DUNNING_OFFSETS_DAYS = [0, 1, 3, 7] as const;

export const DEFAULT_DUNNING_SCHEDULE: DunningSchedule = {
  offsetsDays: DEFAULT_DUNNING_OFFSETS_DAYS,
};

/** Record of one attempt that has been executed. */
export interface DunningAttemptRecord {
  /** 1-based attempt number. */
  attempt: number;
  outcome: DunningOutcome;
  at: IsoTimestamp;
  failureReason?: string;
}

/**
 * The mutable-over-time state of a dunning campaign, stored immutably:
 * every transition returns a new DunningState.
 */
export interface DunningState {
  subscriptionId: string;
  /** Number of attempts already executed (0 before the first attempt runs). */
  attempt: number;
  schedule: DunningSchedule;
  /** When the next attempt should run; undefined once recovered/exhausted. */
  nextAttemptAt?: IsoTimestamp;
  status: DunningStatus;
  history: readonly DunningAttemptRecord[];
  startedAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}
