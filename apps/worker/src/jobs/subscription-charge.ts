/**
 * Subscription charge job: collects every due period of every onchain
 * subscription (Permit2 / spend permission / SPL delegate pulls, renewal
 * invoices) through the shared charge engine. Each (subscription, period) is
 * claimed atomically in the store, so overlapping ticks or several worker
 * replicas never charge a period twice; failures walk dunning and suspend
 * entitlements once it is exhausted; successes extend access.
 * No-op until onchain billing is configured.
 */
import type { Job, JobContext, JobResult } from "./types.js";

export const subscriptionChargeJob: Job = {
  name: "subscription-charge",
  async run(ctx: JobContext): Promise<JobResult> {
    const billing = ctx.onchainBilling;
    if (!billing) return { processed: 0, failed: 0 };
    const summary = await billing.engine.runDue();
    if (summary.processed > 0) {
      ctx.logger.info("subscription charges processed", {
        processed: summary.processed,
        succeeded: summary.succeeded,
        failed: summary.failed,
        outcomes: summary.outcomes,
      });
    }
    return { processed: summary.processed, failed: summary.failed };
  },
};
