/**
 * Payment confirmation poller.
 *
 * For every pending payment that carries an on-chain transaction hash, this job
 * loads the payment's checkout session and verifies the transfer on the
 * payment's own network against the session's payTo address (see
 * ./payment-verification.ts): every enabled EVM chain (Arc included) via
 * `@settlekit/chains`, Solana via `@settlekit/solana`, Zcash via
 * `@settlekit/zcash`. Networks the worker cannot verify stay pending (fail
 * closed); late Zcash payments are logged for manual review. Once verified it advances the payment via `@settlekit/payments`
 * `confirmPayment` and, if the payment has a queued delivery run, flips that
 * run to runnable so the delivery job picks it up on its next tick.
 */

import { completeSession, confirmPayment } from "@settlekit/payments";
import { grantFromPayment } from "@settlekit/entitlements";
import type { CheckoutSession, Payment } from "@settlekit/common";
import { errorMessage } from "../logger.js";
import { verifyPaymentOnChain } from "./payment-verification.js";
import { emitPaymentConfirmed } from "./webhook-events.js";
import type { Job, JobContext, JobResult } from "./types.js";

/**
 * Complete the session and grant catalog entitlements for a payment the
 * WORKER confirmed (not the buyer's own browser via the checkout app's
 * `confirmOnce`/`fulfillOnce`, nor the API's `/payments/:id/confirm` route).
 *
 * Without this, a payment claimed via `claimTxHash` and left for the worker
 * to finish confirming (the buyer closed the tab, or an agent never polls)
 * settles on-chain and raises the seller's webhook, but the checkout
 * session's status stays "open" forever: the success/receipt page 409s
 * "not paid yet" forever and no entitlement is ever created, so the GitHub
 * invite / Discord role retry jobs (which only act on existing entitlements)
 * have nothing to retry.
 */
async function completeAndGrant(ctx: JobContext, payment: Payment, session: CheckoutSession): Promise<void> {
  if (session.status === "open") {
    await ctx.stores.saveCheckoutSession(completeSession(session));
  }
  const alreadyGranted = (await ctx.stores.allEntitlements()).some(
    (e) => e.grantedBy.type === "payment" && e.grantedBy.id === payment.id,
  );
  if (alreadyGranted) return;
  for (const item of session.lineItems) {
    if (item.productId === undefined) continue;
    const product = await ctx.stores.getProduct(item.productId);
    if (!product) continue;
    await ctx.stores.upsertEntitlement(grantFromPayment({ payment, product, now: ctx.now() }));
  }
}

export const paymentConfirmJob: Job = {
  name: "payment-confirm",
  async run(ctx: JobContext): Promise<JobResult> {
    const pending = await ctx.stores.pendingPayments();
    let processed = 0;
    let failed = 0;

    for (const payment of pending) {
      const txHash = payment.txHash;
      if (txHash === undefined || txHash.length === 0) {
        // Not yet observed on-chain; nothing to verify this tick.
        continue;
      }

      try {
        const session = await ctx.stores.getCheckoutSession(payment.checkoutSessionId);
        if (!session) {
          // Without the session there is no trusted payTo to verify against.
          ctx.logger.warn("payment has no checkout session; cannot verify", {
            paymentId: payment.id,
            checkoutSessionId: payment.checkoutSessionId,
          });
          continue;
        }

        const verification = await verifyPaymentOnChain(ctx, payment, txHash, session);
        if (verification.status === "review") {
          ctx.logger.warn("payment needs manual review", {
            paymentId: payment.id,
            network: payment.network,
            reason: verification.reason,
          });
          continue;
        }
        if (verification.status !== "confirmed") {
          ctx.logger.debug("payment not confirmed on-chain", {
            paymentId: payment.id,
            network: payment.network,
            status: verification.status,
            reason: verification.reason,
          });
          continue;
        }

        const confirmed = confirmPayment(
          payment,
          txHash,
          verification.confirmations,
          verification.minConfirmations,
          ctx.now(),
        );
        await ctx.stores.upsertPayment(confirmed);
        await emitPaymentConfirmed(ctx, confirmed, session);
        await completeAndGrant(ctx, confirmed, session);
        processed += 1;

        // Make the matching delivery run executable now the payment settled.
        const queued = await ctx.stores.deliveryRunByPayment(payment.id);
        if (queued) {
          await ctx.stores.enqueueDelivery({ ...queued, run: { ...queued.run, status: "pending" } });
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
