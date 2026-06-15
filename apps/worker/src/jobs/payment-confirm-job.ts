/**
 * Payment confirmation poller.
 *
 * For every pending payment that carries an on-chain transaction hash, this job
 * uses the real {@link ArcClient} to verify the USDC transfer landed and to read
 * the current confirmation count. Once the configured minimum confirmations are
 * met it advances the payment via `@settlekit/payments` `confirmPayment` and, if
 * the payment has a queued delivery run, flips that run to runnable so the
 * delivery job picks it up on its next tick.
 */

import { confirmPayment } from "@settlekit/payments";
import type { Hex } from "@settlekit/arc";
import { errorMessage } from "../logger.js";
import type { Job, JobContext, JobResult } from "./types.js";

function isHex(value: string | undefined): value is Hex {
  return typeof value === "string" && /^0x[a-fA-F0-9]+$/.test(value);
}

export const paymentConfirmJob: Job = {
  name: "payment-confirm",
  async run(ctx: JobContext): Promise<JobResult> {
    const pending = ctx.stores.pendingPayments();
    const minConfirmations = ctx.config.arc.minConfirmations;
    let processed = 0;
    let failed = 0;

    for (const payment of pending) {
      if (!isHex(payment.txHash)) {
        // Not yet observed on-chain; nothing to verify this tick.
        continue;
      }

      try {
        const verification = await ctx.arc.verifyUsdcTransfer({
          txHash: payment.txHash,
          to: ctx.config.arc.usdcAddress,
          minAmount: payment.amount,
        });

        if (!verification.confirmed) {
          ctx.logger.debug("payment transfer not yet confirmed on-chain", {
            paymentId: payment.id,
            confirmations: verification.confirmations,
          });
          continue;
        }

        if (verification.confirmations < minConfirmations) {
          ctx.logger.debug("payment awaiting confirmations", {
            paymentId: payment.id,
            confirmations: verification.confirmations,
            required: minConfirmations,
          });
          continue;
        }

        const confirmed = confirmPayment(
          payment,
          payment.txHash,
          verification.confirmations,
          minConfirmations,
          ctx.now(),
        );
        ctx.stores.payments.upsert(confirmed);
        processed += 1;

        // Make the matching delivery run executable now the payment settled.
        const queued = ctx.stores.deliveryRuns.filter((q) => q.paymentId === payment.id).at(0);
        if (queued) {
          ctx.stores.enqueueDelivery({ ...queued, run: { ...queued.run, status: "pending" } });
          ctx.logger.info("payment confirmed; delivery enqueued", {
            paymentId: payment.id,
            deliveryRunId: queued.run.id,
          });
        } else {
          ctx.logger.info("payment confirmed", { paymentId: payment.id });
        }
      } catch (error) {
        failed += 1;
        ctx.logger.error("payment confirmation failed", {
          paymentId: payment.id,
          error: errorMessage(error),
        });
      }
    }

    return { processed, failed };
  },
};
