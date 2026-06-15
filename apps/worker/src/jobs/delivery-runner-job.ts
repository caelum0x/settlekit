/**
 * Delivery execution job.
 *
 * Consumes pending delivery runs from the store and drives each through the
 * real {@link DeliveryRunner} with the concrete wired clients. New runs are
 * executed from scratch; previously failed/partially-failed runs are retried via
 * `retryRun`, which re-attempts only the failed actions. The resulting immutable
 * run snapshot is persisted back to the store.
 */

import { retryRun, type DeliveryContext } from "@settlekit/delivery";
import { errorMessage } from "../logger.js";
import type { Job, JobContext, JobResult } from "./types.js";
import type { QueuedDeliveryRun } from "../stores.js";

function buildContext(item: QueuedDeliveryRun, ctx: JobContext): DeliveryContext {
  return {
    organizationId: item.organizationId,
    customerId: item.customerId,
    productId: item.productId,
    paymentId: item.paymentId,
    entitlementId: item.entitlementId,
    ...(item.githubInstallationId !== undefined ? { githubInstallationId: item.githubInstallationId } : {}),
    ...(item.githubUsername !== undefined ? { githubUsername: item.githubUsername } : {}),
    ...(item.discordUserId !== undefined ? { discordUserId: item.discordUserId } : {}),
    ...(item.customerEmail !== undefined ? { customerEmail: item.customerEmail } : {}),
    clients: ctx.clients,
  };
}

export const deliveryRunnerJob: Job = {
  name: "delivery-runner",
  async run(ctx: JobContext): Promise<JobResult> {
    const pending = ctx.stores.pendingDeliveryRuns();
    let processed = 0;
    let failed = 0;

    for (const item of pending) {
      const deliveryCtx = buildContext(item, ctx);
      try {
        const isRetry = item.run.status === "failed" || item.run.status === "partially_failed";
        const result = isRetry
          ? await retryRun(item.run, ctx.runner, deliveryCtx)
          : await ctx.runner.executePending(item.run, deliveryCtx);

        ctx.stores.enqueueDelivery({ ...item, run: result });
        processed += 1;

        if (result.status === "succeeded") {
          ctx.logger.info("delivery run completed", { deliveryRunId: result.id, status: result.status });
        } else {
          failed += 1;
          ctx.logger.warn("delivery run did not fully succeed", {
            deliveryRunId: result.id,
            status: result.status,
          });
        }
      } catch (error) {
        failed += 1;
        ctx.logger.error("delivery run threw", {
          deliveryRunId: item.run.id,
          error: errorMessage(error),
        });
      }
    }

    return { processed, failed };
  },
};
