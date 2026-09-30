/**
 * Scheduled invoice settlement: marks every open, sent invoice paid once one
 * of its checkout sessions has a confirmed payment, and emits `invoice.paid`.
 *
 * Shared by the worker (scheduled sweep) so an invoice settles even when the
 * payer confirmed through the hosted checkout and nobody reads the invoice.
 * The API applies the same rule on read.
 */
import type { Payment } from "@settlekit/common";
import {
  checkoutSessionIdsOf,
  reconcileInvoice,
  type Invoice,
  type InvoiceSettlement,
  type InvoiceStore,
} from "@settlekit/invoices";
import { emitWebhookSafely, type WebhookOutbox } from "./webhook-outbox.js";
import { invoicePaidWebhook } from "./webhook-payloads.js";

export interface SettleInvoicesInput {
  invoices: InvoiceStore;
  /** Confirmed payments to match against invoice sessions. */
  confirmedPayments: readonly Payment[];
  webhooks?: WebhookOutbox;
  now?: Date;
}

export interface SettleInvoicesResult {
  settled: Invoice[];
  failed: { invoiceId: string; error: string }[];
}

function settlementOf(payment: Payment): InvoiceSettlement {
  return {
    paymentId: payment.id,
    checkoutSessionId: payment.checkoutSessionId,
    amount: payment.amount.amount,
    network: payment.network,
    organizationId: payment.organizationId,
    ...(payment.txHash ? { txHash: payment.txHash } : {}),
    ...(payment.confirmedAt ? { confirmedAt: payment.confirmedAt } : {}),
  };
}

export async function settleOpenInvoices(input: SettleInvoicesInput): Promise<SettleInvoicesResult> {
  const bySession = new Map<string, Payment>();
  for (const p of input.confirmedPayments) {
    if (p.status === "confirmed") bySession.set(p.checkoutSessionId, p);
  }
  const open = await input.invoices.list((inv) => inv.status === "open" && checkoutSessionIdsOf(inv).length > 0);
  const settled: Invoice[] = [];
  const failed: { invoiceId: string; error: string }[] = [];
  for (const invoice of open) {
    try {
      const next = await reconcileInvoice(
        invoice,
        async (sessionId) => {
          const payment = bySession.get(sessionId);
          return payment ? settlementOf(payment) : undefined;
        },
        input.now,
      );
      if (!next) continue;
      const saved = await input.invoices.save(next);
      await emitWebhookSafely(input.webhooks, invoicePaidWebhook(saved));
      settled.push(saved);
    } catch (error) {
      failed.push({ invoiceId: invoice.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { settled, failed };
}
