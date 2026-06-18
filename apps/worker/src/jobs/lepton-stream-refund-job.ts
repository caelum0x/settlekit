/**
 * Lepton stream refund sweep.
 *
 * When a payment stream stops, the reserved-but-unused remainder is owed back to
 * the viewer. This job finds stopped streams that still have a refundable
 * balance and no refund recorded, settles that balance back to the payer via the
 * settlement provider, and marks the stream refunded.
 *
 * No-op when the settlement provider or stream store is not configured.
 */
import { compareMoney, money, toIso } from "@settlekit/common";
import { errorMessage } from "../logger.js";
import type { Job, JobContext, JobResult } from "./types.js";

export const leptonStreamRefundJob: Job = {
  name: "lepton-stream-refund",
  async run(ctx: JobContext): Promise<JobResult> {
    if (!ctx.settlementProvider || !ctx.streamStore) {
      return { processed: 0, failed: 0 };
    }

    const stopped = await ctx.streamStore.listByState("stopped");
    const refundable = stopped.filter(
      (s) => s.refundedAt === undefined && compareMoney(money(s.refundableUsdc), money("0")) > 0,
    );
    if (refundable.length === 0) {
      return { processed: 0, failed: 0 };
    }

    let processed = 0;
    let failed = 0;
    for (const stream of refundable) {
      try {
        await ctx.settlementProvider.settle({
          reference: `stream-refund:${stream.id}`,
          to: stream.payer,
          amountUsdc: stream.refundableUsdc,
          network: stream.network,
        });
        await ctx.streamStore.markRefunded(stream.id, toIso(ctx.now()));
        processed += 1;
        ctx.logger.info("stream reserve refunded", {
          streamId: stream.id,
          amount: stream.refundableUsdc,
        });
      } catch (error) {
        failed += 1;
        ctx.logger.error("stream refund failed", {
          streamId: stream.id,
          error: errorMessage(error),
        });
      }
    }
    return { processed, failed };
  },
};
