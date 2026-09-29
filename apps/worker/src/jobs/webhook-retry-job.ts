/**
 * Webhook retry queue.
 *
 * Redelivers webhook jobs that are still pending or previously failed using the
 * real `@settlekit/webhooks` `deliverWithRetry`, which re-signs each attempt and
 * applies exponential backoff. Successful deliveries are marked `delivered`;
 * exhausted ones remain `failed` (with their attempt count incremented) for a
 * later sweep or manual replay.
 */

import { deliverWithRetry } from "@settlekit/webhooks";
import { errorMessage } from "../logger.js";
import type { Job, JobContext, JobResult } from "./types.js";

/** Short in-tick backoff; later ticks keep retrying until the attempt cap. */
const TICK_SCHEDULE = [0, 2, 10] as const;
/** Give up on an endpoint after this many attempts (kept as `failed` for manual replay). */
export const MAX_WEBHOOK_ATTEMPTS = 24;

export const webhookRetryJob: Job = {
  name: "webhook-retry",
  async run(ctx: JobContext): Promise<JobResult> {
    const pending = (await ctx.stores.pendingWebhookJobs()).filter((job) => job.attempts < MAX_WEBHOOK_ATTEMPTS);
    let processed = 0;
    let failed = 0;

    for (const job of pending) {
      try {
        const outcome = await deliverWithRetry({
          endpoint: job.endpoint,
          event: job.event,
          schedule: TICK_SCHEDULE,
        });
        const attempts = job.attempts + outcome.attempts.length;
        processed += 1;

        if (outcome.ok) {
          await ctx.stores.upsertWebhookJob({ ...job, status: "delivered", attempts });
          ctx.logger.info("webhook redelivered", { webhookJobId: job.id, attempts });
        } else {
          failed += 1;
          await ctx.stores.upsertWebhookJob({ ...job, status: "failed", attempts });
          const last = outcome.attempts.at(-1);
          ctx.logger.warn("webhook redelivery exhausted", {
            webhookJobId: job.id,
            attempts,
            lastStatus: last?.result.status ?? 0,
          });
        }
      } catch (error) {
        failed += 1;
        await ctx.stores.upsertWebhookJob({ ...job, status: "failed", attempts: job.attempts + 1 });
        ctx.logger.error("webhook redelivery threw", {
          webhookJobId: job.id,
          error: errorMessage(error),
        });
      }
    }

    return { processed, failed };
  },
};
