/**
 * Invoice settle job.
 *
 * Invoices and payment requests are paid through ordinary checkout sessions.
 * Each tick marks every open, sent invoice paid once one of its sessions has
 * a confirmed payment (the same rule the API applies on read) and queues the
 * seller's `invoice.paid` webhook. No-op without an invoice store.
 */
import { settleOpenInvoices } from "@settlekit/persistence";
import type { Job, JobContext, JobResult } from "./types.js";

export const invoiceSettleJob: Job = {
  name: "invoice-settle",
  async run(ctx: JobContext): Promise<JobResult> {
    if (!ctx.invoices) return { processed: 0, failed: 0 };
    const result = await settleOpenInvoices({
      invoices: ctx.invoices,
      confirmedPayments: await ctx.stores.confirmedPayments(),
      ...(ctx.webhooks ? { webhooks: ctx.webhooks } : {}),
      now: ctx.now(),
    });
    for (const invoice of result.settled) {
      ctx.logger.info("invoice settled", { invoiceId: invoice.id, paymentId: invoice.metadata.paymentId });
    }
    for (const failure of result.failed) {
      ctx.logger.error("invoice settle failed", failure);
    }
    return { processed: result.settled.length, failed: result.failed.length };
  },
};
