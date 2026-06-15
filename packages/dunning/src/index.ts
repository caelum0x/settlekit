import { addDays, type Subscription } from "@settlekit/common";

export * from "./types.js";
export * from "./dunning.js";
export * from "./store.js";
export * from "./service.js";

// --- Legacy API (preserved for existing callers) -------------------------

export interface DunningAttempt {
  subscriptionId: string;
  attemptNumber: number;
  scheduledAt: string;
  channel: "email" | "webhook";
}

export function createDunningSchedule(
  subscription: Subscription,
  retryDays: number[],
  now = new Date(),
): DunningAttempt[] {
  return retryDays.map((days, index) => ({
    subscriptionId: subscription.id,
    attemptNumber: index + 1,
    scheduledAt: addDays(now, days).toISOString(),
    channel: index === retryDays.length - 1 ? "webhook" : "email",
  }));
}

export function shouldRevokeAfterDunning(
  subscription: Subscription,
  attempts: DunningAttempt[],
  now = new Date(),
): boolean {
  const lastAttempt = attempts.at(-1);
  return (
    subscription.status === "past_due" &&
    lastAttempt !== undefined &&
    new Date(lastAttempt.scheduledAt).getTime() <= now.getTime()
  );
}
