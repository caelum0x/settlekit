/**
 * Subscription lifecycle state machine (plan §15, Phase 1).
 *
 * Status flow:
 *   active --renew--> active (period advanced)
 *   active --enterGrace--> in_grace
 *   in_grace --renew--> active
 *   in_grace --expire--> expired
 *   active|in_grace|past_due --cancel--> canceled (or cancelAtPeriodEnd)
 *
 * Every transition returns a NEW immutable Subscription; inputs are never mutated.
 */

import {
  generateId,
  periodEnd,
  addDays,
  toIso,
  validationError,
  conflict,
  type Price,
  type Subscription,
  type PriceInterval,
} from "@settlekit/common";

/** Default grace window (days) after a missed renewal before access is revoked. */
export const DEFAULT_GRACE_DAYS = 3;

/** Interval values that are valid for a recurring subscription. */
type RecurringInterval = Extract<PriceInterval, "monthly" | "yearly">;

function assertRecurring(interval: PriceInterval): RecurringInterval {
  if (interval !== "monthly" && interval !== "yearly") {
    throw validationError(
      `Subscriptions require a recurring price interval, got "${interval}"`,
    );
  }
  return interval;
}

export interface CreateSubscriptionInput {
  readonly organizationId: string;
  readonly customerId: string;
  readonly productId: string;
  readonly price: Price;
  readonly cancelAtPeriodEnd?: boolean;
}

/**
 * Create a new active subscription whose first period starts at `start`.
 * The current period end is derived from the price interval via periodEnd().
 */
export function createSubscription(
  input: CreateSubscriptionInput,
  start: Date = new Date(),
): Subscription {
  const interval = assertRecurring(input.price.interval);
  const periodStart = start;
  const end = periodEnd(periodStart, interval);

  return {
    id: generateId("subscription"),
    organizationId: input.organizationId,
    customerId: input.customerId,
    productId: input.productId,
    priceId: input.price.id,
    status: "active",
    currentPeriodStart: toIso(periodStart),
    currentPeriodEnd: toIso(end),
    cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
    createdAt: toIso(periodStart),
  };
}

/**
 * Advance a subscription to its next billing period.
 *
 * The new period starts at the previous currentPeriodEnd and the next end is
 * computed via periodEnd(). Clears any grace window and returns to "active".
 * If the subscription is set to cancel at period end, renewing instead
 * transitions it to "canceled".
 *
 * Returns a NEW Subscription.
 */
export function renewSubscription(
  subscription: Subscription,
  interval: RecurringInterval,
): Subscription {
  if (
    subscription.status !== "active" &&
    subscription.status !== "in_grace" &&
    subscription.status !== "past_due"
  ) {
    throw conflict(
      `Cannot renew a ${subscription.status} subscription`,
      { subscriptionId: subscription.id, status: subscription.status },
    );
  }

  if (subscription.cancelAtPeriodEnd) {
    // Scheduled cancellation takes effect at renewal time.
    const { graceEndsAt: _dropGrace, ...rest } = subscription;
    return { ...rest, status: "canceled" };
  }

  const newStart = new Date(subscription.currentPeriodEnd);
  const newEnd = periodEnd(newStart, interval);

  const { graceEndsAt: _dropGrace, ...rest } = subscription;
  return {
    ...rest,
    status: "active",
    currentPeriodStart: toIso(newStart),
    currentPeriodEnd: toIso(newEnd),
  };
}

/**
 * Move an active/past-due subscription into the grace window after a missed
 * renewal. Sets graceEndsAt = now + graceDays and status "in_grace".
 *
 * Returns a NEW Subscription.
 */
export function enterGrace(
  subscription: Subscription,
  now: Date = new Date(),
  graceDays: number = DEFAULT_GRACE_DAYS,
): Subscription {
  if (!Number.isInteger(graceDays) || graceDays < 1) {
    throw validationError(
      `graceDays must be a positive integer, got ${graceDays}`,
    );
  }
  if (subscription.status !== "active" && subscription.status !== "past_due") {
    throw conflict(
      `Cannot enter grace from a ${subscription.status} subscription`,
      { subscriptionId: subscription.id, status: subscription.status },
    );
  }
  return {
    ...subscription,
    status: "in_grace",
    graceEndsAt: toIso(addDays(now, graceDays)),
  };
}

/**
 * Cancel a subscription.
 *
 * - immediate=false (default): schedules cancellation at the period boundary
 *   (cancelAtPeriodEnd=true) while keeping access until then.
 * - immediate=true: terminates access now, transitioning to "canceled".
 *
 * Returns a NEW Subscription. Already-canceled/expired subscriptions cannot be
 * canceled again.
 */
export function cancelSubscription(
  subscription: Subscription,
  immediate = false,
): Subscription {
  if (subscription.status === "canceled" || subscription.status === "expired") {
    throw conflict(
      `Cannot cancel a ${subscription.status} subscription`,
      { subscriptionId: subscription.id, status: subscription.status },
    );
  }
  if (immediate) {
    const { graceEndsAt: _dropGrace, ...rest } = subscription;
    return { ...rest, status: "canceled", cancelAtPeriodEnd: true };
  }
  return { ...subscription, cancelAtPeriodEnd: true };
}

/**
 * Expire a subscription whose grace window has elapsed (access revoked).
 * Returns a NEW Subscription. Only in_grace/past_due subscriptions expire.
 */
export function expireSubscription(
  subscription: Subscription,
): Subscription {
  if (subscription.status === "expired") {
    return subscription;
  }
  if (
    subscription.status !== "in_grace" &&
    subscription.status !== "past_due"
  ) {
    throw conflict(
      `Cannot expire a ${subscription.status} subscription`,
      { subscriptionId: subscription.id, status: subscription.status },
    );
  }
  const { graceEndsAt: _dropGrace, ...rest } = subscription;
  return { ...rest, status: "expired" };
}

/** True when the subscription's grace window has elapsed relative to `now`. */
export function isGraceExpired(
  subscription: Subscription,
  now: Date = new Date(),
): boolean {
  if (subscription.graceEndsAt === undefined) {
    return false;
  }
  return new Date(subscription.graceEndsAt).getTime() <= now.getTime();
}
