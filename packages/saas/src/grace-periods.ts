/**
 * Renewal grace-period state machine (plan §20).
 *
 * When a renewal payment is due but not yet received, a subscription enters a
 * grace window (`in_grace`) until `graceEndsAt`. If the grace window passes
 * without payment, access is `expired`. Successful renewal returns it to
 * `active`. This module is pure: it computes the next status given the clock.
 */
import { addDays } from "@settlekit/common";
import type { Subscription, SubscriptionStatus, IsoTimestamp } from "@settlekit/common";

/** Compute the end of a grace window starting at `from`. */
export function graceEndsAt(from: Date, graceDays: number): IsoTimestamp {
  if (!Number.isInteger(graceDays) || graceDays < 0) {
    throw new RangeError(`graceDays must be a non-negative integer, got ${graceDays}`);
  }
  return addDays(from, graceDays).toISOString();
}

/** Input for {@link applyGracePeriod}. */
export interface GracePeriodInput {
  subscription: Subscription;
  /** Number of days of grace granted after the period end. */
  graceDays: number;
  /** Whether the renewal payment has been received. */
  renewed: boolean;
  now?: Date;
}

/**
 * Advance a subscription's status through the renewal grace lifecycle.
 *
 * Transitions (immutable — returns a NEW subscription):
 *  - renewal received           -> `active`, period rolled, grace cleared
 *  - period ended, in grace     -> `in_grace` with `graceEndsAt` set
 *  - grace window elapsed        -> `expired`
 *  - period not yet ended        -> unchanged (still `active`)
 */
export function applyGracePeriod(input: GracePeriodInput): Subscription {
  const { subscription, graceDays, renewed } = input;
  const now = input.now ?? new Date();
  const periodEnd = new Date(subscription.currentPeriodEnd);

  if (renewed) {
    const { graceEndsAt: _drop, ...rest } = subscription;
    void _drop;
    return { ...rest, status: "active" satisfies SubscriptionStatus };
  }

  // Renewal not yet due: nothing changes.
  if (now.getTime() < periodEnd.getTime()) {
    return subscription;
  }

  const graceEnd = subscription.graceEndsAt
    ? new Date(subscription.graceEndsAt)
    : new Date(graceEndsAt(periodEnd, graceDays));

  if (now.getTime() <= graceEnd.getTime()) {
    return {
      ...subscription,
      status: "in_grace" satisfies SubscriptionStatus,
      graceEndsAt: graceEnd.toISOString(),
    };
  }

  return {
    ...subscription,
    status: "expired" satisfies SubscriptionStatus,
    graceEndsAt: graceEnd.toISOString(),
  };
}

/** Whether a subscription currently grants access (active or within grace). */
export function isAccessActive(subscription: Subscription): boolean {
  return subscription.status === "active" || subscription.status === "in_grace";
}
