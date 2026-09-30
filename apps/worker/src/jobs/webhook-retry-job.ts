/**
 * Webhook delivery queue.
 *
 * Delivers seller webhook jobs that are due: pending ones immediately, failed
 * ones on an exponential schedule (1m, 2m, 4m ... capped at 6h) until the
 * attempt cap. Each attempt (HTTP status, error, time) is written to the job's
 * log, which the dashboard shows and a merchant can resend from. Deliveries
 * are signed with the endpoint's LIVE secret (plus the pre-rotation secret
 * during its grace window). An endpoint that is disabled is skipped; one that
 * fails too many times in a row is disabled automatically.
 */

import { deliverWithRetry } from "@settlekit/webhooks";
import {
  DEFAULT_DISABLE_AFTER,
  MAX_JOB_ATTEMPTS,
  applyEndpointOutcome,
  isJobDue,
  recordJobAttempts,
  type WebhookAttempt,
} from "@settlekit/persistence";
import { errorMessage } from "../logger.js";
import type { Job, JobContext, JobResult } from "./types.js";

/** Short in-tick backoff; later ticks follow the job's nextAttemptAt. */
const TICK_SCHEDULE = [0, 2, 10] as const;
/** Give up on an endpoint after this many attempts (kept as `failed` for manual resend). */
export const MAX_WEBHOOK_ATTEMPTS = MAX_JOB_ATTEMPTS;

function disableAfter(): number {
  const raw = Number(process.env.WEBHOOK_DISABLE_AFTER_FAILURES);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_DISABLE_AFTER;
}

export const webhookRetryJob: Job = {
  name: "webhook-retry",
  async run(ctx: JobContext): Promise<JobResult> {
    const now = ctx.now();
    const due = (await ctx.stores.pendingWebhookJobs()).filter((job) => isJobDue(job, now));
    let processed = 0;
    let failed = 0;

    for (const job of due) {
      const live = (await ctx.stores.getWebhookEndpoint(job.endpoint.id)) ?? job.endpoint;
      if (!live.active) continue; // resumes when the merchant re-enables it

      let attempts: WebhookAttempt[];
      try {
        const outcome = await deliverWithRetry({
          endpoint: live,
          event: job.event,
          schedule: TICK_SCHEDULE,
          ...(ctx.webhookTransport?.sender ? { sender: ctx.webhookTransport.sender } : {}),
          ...(ctx.webhookTransport?.sleep ? { sleep: ctx.webhookTransport.sleep } : {}),
        });
        attempts = outcome.attempts.map((a) => ({
          at: new Date(a.at).toISOString(),
          status: a.result.status,
          ok: a.result.ok,
          ...(a.result.ok ? {} : { error: a.result.error ?? `HTTP ${a.result.status}` }),
        }));
      } catch (error) {
        attempts = [{ at: now.toISOString(), status: 0, ok: false, error: errorMessage(error) }];
      }

      const next = recordJobAttempts({ ...job, endpoint: live }, attempts, now);
      await ctx.stores.upsertWebhookJob(next);
      processed += 1;
      if (next.status === "delivered") {
        ctx.logger.info("webhook delivered", { webhookJobId: job.id, attempts: next.attempts });
      } else {
        failed += 1;
        ctx.logger.warn("webhook delivery failed", {
          webhookJobId: job.id,
          attempts: next.attempts,
          lastStatus: attempts.at(-1)?.status ?? 0,
          nextAttemptAt: next.nextAttemptAt ?? null,
        });
      }

      const health = applyEndpointOutcome(live, attempts, now, disableAfter());
      if (health.consecutiveFailures !== live.consecutiveFailures || health.active !== live.active) {
        await ctx.stores.saveWebhookEndpoint(health);
        if (!health.active) {
          ctx.logger.warn("webhook endpoint disabled", { endpointId: health.id, reason: health.disabledReason ?? "" });
        }
      }
    }

    return { processed, failed };
  },
};
