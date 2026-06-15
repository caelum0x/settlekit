/**
 * Receipt email job.
 *
 * For every newly-confirmed payment that has not yet had a receipt sent, this
 * job renders an HTML + plaintext receipt with the real `@settlekit/notifications`
 * renderers (`renderReceiptHtml` / `renderReceiptText`) and sends it through the
 * threaded `EmailClient`. The payment id is recorded in the store's
 * `sentReceipts` ledger so a later tick that re-observes the same confirmed
 * payment does not re-send — one receipt per confirmed payment.
 */

import { renderReceiptHtml, renderReceiptText } from "@settlekit/notifications";
import type { Merchant } from "@settlekit/common";
import { errorMessage } from "../logger.js";
import { receiptLineItems, resolveCustomer, resolveMerchant } from "./email-helpers.js";
import type { Job, JobContext, JobResult } from "./types.js";

/** A neutral merchant used when the org has no merchant branding on record. */
function fallbackMerchant(organizationId: string, now: Date): Merchant {
  return {
    id: `merchant_${organizationId}`,
    organizationId,
    displayName: "SettleKit",
    slug: "settlekit",
    createdAt: now.toISOString(),
  };
}

export const receiptEmailJob: Job = {
  name: "receipt-email",
  async run(ctx: JobContext): Promise<JobResult> {
    const now = ctx.now();
    let processed = 0;
    let failed = 0;

    const confirmed = await ctx.stores.confirmedPayments();

    for (const payment of confirmed) {
      if (await ctx.stores.hasSentEmail("receipt", payment.id)) continue;

      const customer = await resolveCustomer(ctx, payment.customerId);
      if (!customer) {
        ctx.logger.warn("receipt skipped; no customer contact on record", {
          paymentId: payment.id,
          customerId: payment.customerId,
        });
        continue;
      }

      const merchant = (await resolveMerchant(ctx, payment.organizationId)) ?? fallbackMerchant(payment.organizationId, now);
      const lineItems = receiptLineItems(payment);

      try {
        const html = renderReceiptHtml(payment, lineItems, merchant);
        const text = renderReceiptText(payment, lineItems, merchant);
        const result = await ctx.email.send({
          to: customer.email,
          subject: `Your receipt from ${merchant.displayName}`,
          html,
          text,
          ...(merchant.supportEmail ? { replyTo: merchant.supportEmail } : {}),
          tags: [
            { name: "type", value: "receipt" },
            { name: "payment_id", value: payment.id },
          ],
        });

        // Mark sent only after the transport accepts it, so a send failure is
        // retried on the next tick rather than silently dropped.
        await ctx.stores.markEmailSent("receipt", payment.id);
        processed += 1;
        ctx.logger.info("receipt email sent", {
          paymentId: payment.id,
          to: customer.email,
          messageId: result.id,
        });
      } catch (error) {
        failed += 1;
        ctx.logger.error("receipt email failed", {
          paymentId: payment.id,
          error: errorMessage(error),
        });
      }
    }

    return { processed, failed };
  },
};
