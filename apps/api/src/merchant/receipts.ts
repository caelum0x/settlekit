/**
 * Tax-grade receipts for settled checkouts.
 *
 * A receipt is rendered from the completed session and its confirmed payment:
 * line items at list price, promo discount, tax with its rate and
 * jurisdiction (or "reverse charge"), the seller's legal name and tax ID,
 * the buyer's billing country and VAT ID, and the settlement transaction.
 * Invoice sessions reuse the paid invoice itself. The checkout session id is
 * the capability (the same one the hosted checkout's success page uses).
 */
import { addMoney, effectiveUnitAmount, money, multiplyMoney, notFound, type CheckoutSession, type Payment } from "@settlekit/common";
import { renderInvoicePdf, type Invoice, type InvoicePdfOptions } from "@settlekit/invoices";
import type { AppContext } from "../context.js";
import { invoiceMerchant, reconcileInvoiceWithPayments } from "./invoice-payments.js";

function pct(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

async function settledSession(ctx: AppContext, sessionId: string): Promise<{ session: CheckoutSession; payment: Payment }> {
  const session = await ctx.checkouts.findById(sessionId);
  const payments = session ? await ctx.payments.findByCheckoutSessionId(session.id) : [];
  const payment = payments.find((p) => p.status === "confirmed" || p.status === "refunded");
  if (!session || !payment) throw notFound("No settled payment for this checkout");
  return { session, payment };
}

async function receiptDocument(ctx: AppContext, session: CheckoutSession, payment: Payment): Promise<Invoice> {
  if (session.invoiceId) {
    const found = await ctx.invoices.get(session.invoiceId);
    if (found.ok) return reconcileInvoiceWithPayments(ctx, found.value);
  }
  const lineItems = await Promise.all(
    session.lineItems.map(async (line) => {
      const price = await ctx.prices.findById(line.priceId);
      const product = await ctx.products.findById(price?.productId ?? line.productId ?? "");
      return {
        description: product?.name ?? "Purchase",
        quantity: line.quantity,
        unitAmount: money(price ? effectiveUnitAmount(price, session.fxQuote) : "0", price?.currency ?? payment.amount.currency),
      };
    }),
  );
  const listed = lineItems.reduce((sum, l) => addMoney(sum, multiplyMoney(l.unitAmount, l.quantity)), money("0"));
  const at = payment.confirmedAt ?? payment.createdAt;
  return {
    id: `rcpt_${payment.id}`,
    number: `R-${payment.id.replace(/^[a-z]+_/, "").slice(-10).toUpperCase()}`,
    organizationId: session.organizationId,
    customerId: payment.customerId,
    lineItems,
    subtotal: session.discount?.subtotal ?? listed,
    ...(session.discount ? { discount: session.discount.amountOff } : {}),
    ...(session.tax ? { tax: session.tax.amount } : {}),
    total: payment.amount,
    currency: payment.amount.currency,
    status: "paid",
    issuedAt: at,
    paidAt: at,
    metadata: {
      paidNetwork: payment.network,
      ...(payment.txHash ? { paidTxHash: payment.txHash } : {}),
    },
  };
}

/** Render the receipt PDF for a settled checkout session. */
export async function receiptPdf(ctx: AppContext, sessionId: string): Promise<{ pdf: Buffer; filename: string }> {
  const { session, payment } = await settledSession(ctx, sessionId);
  const doc = await receiptDocument(ctx, session, payment);
  const settings = await ctx.orgSettings.get(session.organizationId);
  const merchant = await invoiceMerchant(ctx, session.organizationId);
  const tax = settings.tax;
  const fields = session.collectedFields;
  const options: InvoicePdfOptions = {
    title: "Receipt",
    ...(tax
      ? {
          seller: {
            ...(tax.taxId ? { taxId: tax.taxId } : {}),
            ...(tax.sellerCountry ? { country: tax.sellerCountry } : {}),
            ...(tax.addressLines ? { addressLines: tax.addressLines } : {}),
          },
        }
      : {}),
    buyer: {
      ...(fields.name ? { name: fields.name } : {}),
      ...(fields.email ? { email: fields.email } : {}),
      ...(session.tax?.country ? { country: session.tax.country } : {}),
      ...(session.tax?.vatId ? { taxId: session.tax.vatId } : {}),
    },
    ...(session.tax
      ? {
          taxLabel: session.tax.reverseCharge
            ? `${session.tax.label} 0% (reverse charge: VAT due by the buyer)`
            : `${session.tax.label} ${pct(session.tax.rateBps)} (${session.tax.jurisdiction})`,
        }
      : {}),
  };
  const pdf = await renderInvoicePdf(doc, { ...merchant, ...(tax?.legalName ? { name: tax.legalName } : {}) }, options);
  return { pdf, filename: `${doc.number}.pdf` };
}
