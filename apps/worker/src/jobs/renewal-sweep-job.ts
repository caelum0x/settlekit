/**
 * Renewal / grace sweep.
 *
 * Advances the subscription lifecycle using the real `@settlekit/payments`
 * functions:
 *  - An active subscription past its period end with a confirmed renewal
 *    payment is renewed (`renewSubscription`) into the next period.
 *  - An active subscription past its period end without payment enters the grace
 *    window (`enterGrace`).
 *  - A grace subscription whose grace has elapsed is expired
 *    (`expireSubscription`) and its SaaS access marked entitlement-expired so the
 *    access-sync job revokes downstream grants.
 */

import {
  renewSubscription,
  enterGrace,
  expireSubscription,
  isGraceExpired,
} from "@settlekit/payments";
import { isPast } from "@settlekit/common";
import { errorMessage } from "../logger.js";
import type { Job, JobContext, JobResult } from "./types.js";

/** True when a confirmed payment exists for this subscription's customer + product. */
function hasConfirmedRenewal(ctx: JobContext, customerId: string, productId: string, after: Date): boolean {
  return ctx.stores.payments
    .filter((p) => p.customerId === customerId && p.status === "confirmed")
    .some((p) => {
      const stamp = p.confirmedAt ? new Date(p.confirmedAt) : new Date(p.createdAt);
      return stamp.getTime() >= after.getTime();
    });
}

export const renewalSweepJob: Job = {
  name: "renewal-sweep",
  async run(ctx: JobContext): Promise<JobResult> {
    const now = ctx.now();
    let processed = 0;
    let failed = 0;

    for (const subscription of ctx.stores.subscriptions.all()) {
      try {
        if (subscription.status === "canceled" || subscription.status === "expired") {
          continue;
        }

        const periodOver = isPast(subscription.currentPeriodEnd, now);

        // In grace and grace elapsed -> expire.
        if (subscription.status === "in_grace" && isGraceExpired(subscription, now)) {
          ctx.stores.subscriptions.upsert(expireSubscription(subscription));
          processed += 1;
          ctx.logger.info("subscription expired after grace", { subscriptionId: subscription.id });
          continue;
        }

        if (!periodOver) continue;

        const periodEnd = new Date(subscription.currentPeriodEnd);
        if (hasConfirmedRenewal(ctx, subscription.customerId, subscription.productId, periodEnd)) {
          const interval = ctx.stores.subscriptionIntervals.get(subscription.id) ?? "monthly";
          const renewed = renewSubscription(subscription, interval);
          ctx.stores.subscriptions.upsert(renewed);
          processed += 1;
          ctx.logger.info("subscription renewed", {
            subscriptionId: subscription.id,
            status: renewed.status,
            currentPeriodEnd: renewed.currentPeriodEnd,
          });
          continue;
        }

        // Period over, no renewal payment, not yet in grace -> enter grace.
        if (subscription.status === "active" || subscription.status === "past_due") {
          const graced = enterGrace(subscription, now, ctx.config.graceDays);
          ctx.stores.subscriptions.upsert(graced);
          processed += 1;
          ctx.logger.info("subscription entered grace", {
            subscriptionId: subscription.id,
            graceEndsAt: graced.graceEndsAt,
          });
        }
      } catch (error) {
        failed += 1;
        ctx.logger.error("renewal sweep failed for subscription", {
          subscriptionId: subscription.id,
          error: errorMessage(error),
        });
      }
    }

    return { processed, failed };
  },
};
