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

export const webhookRetryJob: Job = {
  name: "webhook-retry",
  async run(ctx: JobContext): Promise<JobResult> {
    const pending = ctx.stores.pendingWebhookJobs();
    let processed = 0;
    let failed = 0;

    for (const job of pending) {
      try {
        const outcome = await deliverWithRetry({
          endpoint: job.endpoint,
          event: job.event,
        });
        const attempts = job.attempts + outcome.attempts.length;
        processed += 1;

        if (outcome.ok) {
          ctx.stores.webhookJobs.upsert({ ...job, status: "delivered", attempts });
          ctx.logger.info("webhook redelivered", { webhookJobId: job.id, attempts });
        } else {
          failed += 1;
          ctx.stores.webhookJobs.upsert({ ...job, status: "failed", attempts });
          const last = outcome.attempts.at(-1);
          ctx.logger.warn("webhook redelivery exhausted", {
            webhookJobId: job.id,
            attempts,
            lastStatus: last?.result.status ?? 0,
          });
        }
      } catch (error) {
        failed += 1;
        ctx.stores.webhookJobs.upsert({ ...job, status: "failed", attempts: job.attempts + 1 });
        ctx.logger.error("webhook redelivery threw", {
          webhookJobId: job.id,
          error: errorMessage(error),
        });
      }
    }

    return { processed, failed };
  },
};
