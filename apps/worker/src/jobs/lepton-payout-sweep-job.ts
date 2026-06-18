/**
 * Lepton royalty payout sweep.
 *
 * Batches pending royalty legs per recipient wallet and settles each group in a
 * single transfer via the configured settlement provider, then marks the swept
 * legs settled. Delegates to the shared `sweepPendingRoyalties` so the worker
 * and the citation-toll sidecars share one money-path implementation.
 *
 * No-op when the settlement provider or royalty-leg store is not configured.
 */
import { sweepPendingRoyalties } from "@settlekit/citation-toll";
import { errorMessage } from "../logger.js";
import type { Job, JobContext, JobResult } from "./types.js";

export const leptonPayoutSweepJob: Job = {
  name: "lepton-payout-sweep",
  async run(ctx: JobContext): Promise<JobResult> {
    if (!ctx.settlementProvider || !ctx.royaltyLegStore) {
      return { processed: 0, failed: 0 };
    }

    const { processed, failed } = await sweepPendingRoyalties(
      ctx.royaltyLegStore,
      ctx.settlementProvider,
      {
        onError: (wallet, error) =>
          ctx.logger.error("royalty payout sweep failed", { wallet, error: errorMessage(error) }),
      },
    );

    if (processed > 0) {
      ctx.logger.info("royalty payouts swept", { processed });
    }
    return { processed, failed };
  },
};
