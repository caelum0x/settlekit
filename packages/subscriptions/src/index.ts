import { addDays, periodEnd, type PriceInterval, type Subscription } from "@settlekit/common";

export function createSubscription(input: Omit<Subscription, "status" | "currentPeriodStart" | "currentPeriodEnd" | "cancelAtPeriodEnd" | "createdAt"> & { interval: Extract<PriceInterval, "monthly" | "yearly"> }, now = new Date()): Subscription {
  return {
    id: input.id,
    organizationId: input.organizationId,
    customerId: input.customerId,
    productId: input.productId,
    priceId: input.priceId,
    status: "active",
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: periodEnd(now, input.interval).toISOString(),
    cancelAtPeriodEnd: false,
    createdAt: now.toISOString(),
  };
}

export function markPastDue(subscription: Subscription, graceDays: number, now = new Date()): Subscription {
  return { ...subscription, status: "past_due", graceEndsAt: addDays(now, graceDays).toISOString() };
}

export function cancelAtPeriodEnd(subscription: Subscription): Subscription {
  return { ...subscription, cancelAtPeriodEnd: true };
}
