/**
 * Payable invoices and payment requests.
 *
 * `send` issues the invoice, binds an unguessable public token (the client's
 * pay page at `<checkout>/i/<token>`), opens a checkout session for the
 * invoice total on the merchant's networks, and emails the link. The session
 * is a normal checkout session (same on-chain verification, same Solana Pay
 * reference / Zcash quote bindings), bought against a hidden per-invoice
 * product so the hosted checkout renders and settles it unchanged.
 *
 * The invoice is marked paid only when a CONFIRMED payment exists for one of
 * its sessions ({@link reconcileInvoiceWithPayments}), which the API runs on
 * read and the worker's invoice-settle job runs on a schedule.
 */
import {
  generateId,
  generateSecret,
  notFound,
  validationError,
  type CheckoutSession,
  type Payment,
  type Price,
  type Product,
} from "@settlekit/common";
import { cancelSession, createCheckoutSession, isSessionExpired } from "@settlekit/payments";
import {
  checkoutSessionIdsOf,
  finalizeInvoice,
  latestCheckoutSessionId,
  payTokenOf,
  reconcileInvoice,
  unpayableReason,
  withCheckoutSession,
  withPayToken,
  withPayerEmail,
  PAYER_EMAIL_KEY,
  type Invoice,
  type InvoiceSettlement,
  type Merchant,
} from "@settlekit/invoices";
import { emitWebhookSafely, invoicePaidWebhook } from "@settlekit/persistence";
import type { AppContext } from "../context.js";
import { bindSession, payableNetworks, saveBoundSession } from "./payment-links.js";
import { merchantIdFor } from "./products.js";

/** Product metadata marker for the hidden per-invoice product. */
export const INVOICE_PRODUCT_KIND = "invoice";

/** Whether a catalog product is the hidden product behind an invoice. */
export function isInvoiceProduct(product: Product): boolean {
  return product.metadata.kind === INVOICE_PRODUCT_KIND;
}

/** Public base URL of the hosted checkout (pay pages live there). */
export function checkoutBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.CHECKOUT_PUBLIC_URL ?? env.NEXT_PUBLIC_CHECKOUT_URL ?? "http://localhost:3000";
  return url.replace(/\/+$/, "");
}

/** The public pay page URL for a pay token. */
export function payUrlFor(token: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${checkoutBaseUrl(env)}/i/${encodeURIComponent(token)}`;
}

function describe(invoice: Invoice): string {
  const lines = invoice.lineItems.map((l) => (l.quantity > 1 ? `${l.quantity} x ${l.description}` : l.description));
  const text = lines.join(", ");
  return text.length > 280 ? `${text.slice(0, 277)}...` : text || `Invoice ${invoice.number}`;
}

/**
 * The hidden product + price a checkout session for this invoice buys. It is
 * archived (never listed or sold through a link) and delivers by email only.
 */
async function ensureInvoiceProduct(ctx: AppContext, invoice: Invoice): Promise<{ product: Product; price: Price }> {
  const [existing] = await ctx.products.list((p) => isInvoiceProduct(p) && p.metadata.invoiceId === invoice.id);
  const now = new Date().toISOString();
  const product =
    existing ??
    (await ctx.products.save({
      id: generateId("product"),
      merchantId: merchantIdFor(invoice.organizationId),
      organizationId: invoice.organizationId,
      name: `Invoice ${invoice.number}`,
      description: describe(invoice),
      type: "consulting_slot",
      status: "archived",
      deliveryMode: "email",
      metadata: { kind: INVOICE_PRODUCT_KIND, invoiceId: invoice.id, template: "invoice_paid" },
      createdAt: now,
      updatedAt: now,
    }));
  const prices = await ctx.prices.list((p) => p.productId === product.id && p.active);
  const matching = prices.find((p) => p.amount === invoice.total.amount && p.currency === invoice.currency);
  if (matching) return { product, price: matching };
  for (const stale of prices) await ctx.prices.save({ ...stale, active: false });
  const price = await ctx.prices.save({
    id: generateId("price"),
    productId: product.id,
    amount: invoice.total.amount,
    currency: invoice.currency,
    interval: "one_time",
    usageBased: false,
    active: true,
    createdAt: now,
  });
  return { product, price };
}

function isStillPayable(session: CheckoutSession | null): session is CheckoutSession {
  return session !== null && session.status === "open" && !isSessionExpired(session);
}

/**
 * The open checkout session for an invoice: the latest one while it is still
 * payable, else a fresh one (recorded on the invoice). Returns the updated
 * invoice with the session.
 */
export async function openInvoiceSession(
  ctx: AppContext,
  invoice: Invoice,
): Promise<{ invoice: Invoice; session: CheckoutSession }> {
  const reason = unpayableReason(invoice);
  if (reason) throw validationError(reason, { invoiceId: invoice.id, status: invoice.status });

  const latestId = latestCheckoutSessionId(invoice);
  const latest = latestId ? await ctx.checkouts.findById(latestId) : null;
  if (isStillPayable(latest) && latest.organizationId === invoice.organizationId && latest.invoiceId === invoice.id) {
    return { invoice, session: latest };
  }

  const { accepted, payTo } = await payableNetworks(ctx, invoice.organizationId);
  if (accepted.length === 0) {
    throw validationError("Add a receiving wallet in payment settings before sending invoices", {
      invoiceId: invoice.id,
    });
  }
  const { product, price } = await ensureInvoiceProduct(ctx, invoice);
  const network = accepted[0]!;
  const payToByNetwork = Object.fromEntries(accepted.map((n) => [n, payTo[n]!]));
  const payerEmail = invoice.metadata[PAYER_EMAIL_KEY];
  const draft = createCheckoutSession({
    organizationId: invoice.organizationId,
    merchantId: merchantIdFor(invoice.organizationId),
    customerId: invoice.customerId,
    items: [{ lineItem: { productId: product.id, priceId: price.id, quantity: 1 }, price }],
    payToAddress: payToByNetwork[network]!,
    network,
    ttlDays: 1,
    ...(payerEmail ? { collectedFields: { email: payerEmail } } : {}),
    ...(invoice.metadata.successUrl ? { successUrl: invoice.metadata.successUrl } : {}),
  });
  const session = await saveBoundSession(
    ctx,
    await bindSession(ctx, { ...draft, acceptedNetworks: accepted, payToByNetwork, invoiceId: invoice.id }),
  );
  const updated = await ctx.invoices.save(withCheckoutSession(invoice, session.id));
  return { invoice: updated, session };
}

/** The confirmed payment for a checkout session, as invoice settlement facts. */
export async function confirmedSettlement(
  ctx: AppContext,
  sessionId: string,
): Promise<InvoiceSettlement | undefined> {
  const payments = await ctx.payments.findByCheckoutSessionId(sessionId);
  const confirmed = payments.find((p: Payment) => p.status === "confirmed");
  if (!confirmed) return undefined;
  return {
    paymentId: confirmed.id,
    checkoutSessionId: sessionId,
    amount: confirmed.amount.amount,
    network: confirmed.network,
    organizationId: confirmed.organizationId,
    ...(confirmed.txHash ? { txHash: confirmed.txHash } : {}),
    ...(confirmed.confirmedAt ? { confirmedAt: confirmed.confirmedAt } : {}),
  };
}

/** Settle an open invoice if one of its sessions has a confirmed payment. */
export async function reconcileInvoiceWithPayments(ctx: AppContext, invoice: Invoice): Promise<Invoice> {
  if (invoice.status !== "open" || checkoutSessionIdsOf(invoice).length === 0) return invoice;
  const settled = await reconcileInvoice(invoice, (id) => confirmedSettlement(ctx, id));
  if (!settled) return invoice;
  const saved = await ctx.invoices.save(settled);
  await emitWebhookSafely(ctx.webhookOutbox, invoicePaidWebhook(saved));
  return saved;
}

export interface SendInvoiceResult {
  invoice: Invoice;
  payUrl: string;
  checkoutSessionId: string;
  emailedTo: string | null;
  /** Why no email went out (no address, email not configured, send error). */
  emailSkipped?: string;
}

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Plain, accessible invoice email: amount, due date and one pay button. */
export function invoiceEmail(invoice: Invoice, merchantName: string, payUrl: string): { subject: string; html: string; text: string } {
  const amount = `${invoice.total.amount} ${invoice.total.currency}`;
  const due = invoice.dueAt ? ` due ${invoice.dueAt.slice(0, 10)}` : "";
  const subject = `Invoice ${invoice.number} from ${merchantName}`;
  const text = [
    `${merchantName} sent you invoice ${invoice.number} for ${amount}${due}.`,
    "",
    ...invoice.lineItems.map((l) => `- ${l.quantity} x ${l.description}: ${l.unitAmount.amount} ${l.unitAmount.currency}`),
    "",
    `Pay online in USDC: ${payUrl}`,
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#111;max-width:560px;margin:auto;padding:24px">
<p>${esc(merchantName)} sent you invoice <strong>${esc(invoice.number)}</strong> for <strong>${esc(amount)}</strong>${esc(due)}.</p>
<ul>${invoice.lineItems.map((l) => `<li>${l.quantity} x ${esc(l.description)}: ${esc(`${l.unitAmount.amount} ${l.unitAmount.currency}`)}</li>`).join("")}</ul>
<p><a href="${esc(payUrl)}" style="display:inline-block;padding:12px 20px;background:#111;color:#fff;border-radius:8px;text-decoration:none">Pay invoice</a></p>
<p style="color:#555;font-size:13px">Or open ${esc(payUrl)}</p>
</body></html>`;
  return { subject, html, text };
}

/**
 * Issue (finalize a draft), bind the pay token, open the checkout session and
 * email the pay link. Idempotent: re-sending keeps the same link.
 */
export async function sendInvoice(
  ctx: AppContext,
  invoice: Invoice,
  options: { payerEmail?: string; env?: NodeJS.ProcessEnv; skipEmail?: boolean } = {},
): Promise<SendInvoiceResult> {
  let current = invoice.status === "draft" ? finalizeInvoice(invoice) : invoice;
  const reason = unpayableReason(current);
  if (reason) throw validationError(reason, { invoiceId: invoice.id, status: current.status });

  const customer = await ctx.customers.findById(current.customerId);
  const payerEmail = options.payerEmail ?? current.metadata[PAYER_EMAIL_KEY] ?? customer?.email ?? undefined;
  current = withPayToken(current, generateSecret(24));
  if (payerEmail) current = withPayerEmail(current, payerEmail);
  current = await ctx.invoices.save(current);

  const opened = await openInvoiceSession(ctx, current);
  const token = payTokenOf(opened.invoice)!;
  const payUrl = payUrlFor(token, options.env);
  const base = { invoice: opened.invoice, payUrl, checkoutSessionId: opened.session.id };

  if (options.skipEmail) return { ...base, emailedTo: null, emailSkipped: "not requested" };
  if (!payerEmail) return { ...base, emailedTo: null, emailSkipped: "no payer email on the invoice or customer" };
  if (!ctx.email) return { ...base, emailedTo: null, emailSkipped: "email is not configured (RESEND_API_KEY)" };
  const { merchantName } = await payableNetworks(ctx, current.organizationId);
  const message = invoiceEmail(opened.invoice, merchantName, payUrl);
  try {
    await ctx.email.send({
      to: payerEmail,
      ...message,
      tags: [
        { name: "type", value: "invoice" },
        { name: "invoice_id", value: opened.invoice.id },
      ],
    });
    return { ...base, emailedTo: payerEmail };
  } catch (error) {
    return { ...base, emailedTo: null, emailSkipped: error instanceof Error ? error.message : "email send failed" };
  }
}

/** Load an invoice by its public pay token (404 when unknown). */
export async function invoiceByToken(ctx: AppContext, token: string): Promise<Invoice> {
  const invoice = await ctx.invoices.findByPayToken(token);
  if (!invoice) throw notFound("This invoice link does not exist");
  return reconcileInvoiceWithPayments(ctx, invoice);
}

/** Buyer-safe view of an invoice for the public pay page. */
export interface PublicInvoiceView {
  number: string;
  status: Invoice["status"];
  merchantName: string;
  currency: string;
  lineItems: { description: string; quantity: number; unitAmount: string }[];
  subtotal: string;
  discount: string | null;
  tax: string | null;
  total: string;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  paidTxHash: string | null;
  paidNetwork: string | null;
  payable: boolean;
  unpayableReason: string | null;
}

export async function publicInvoiceView(ctx: AppContext, invoice: Invoice): Promise<PublicInvoiceView> {
  const { merchantName } = await payableNetworks(ctx, invoice.organizationId);
  const reason = unpayableReason(invoice);
  return {
    number: invoice.number,
    status: invoice.status,
    merchantName,
    currency: invoice.currency,
    lineItems: invoice.lineItems.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitAmount: l.unitAmount.amount,
    })),
    subtotal: invoice.subtotal.amount,
    discount: invoice.discount?.amount ?? null,
    tax: invoice.tax?.amount ?? null,
    total: invoice.total.amount,
    issuedAt: invoice.issuedAt ?? null,
    dueAt: invoice.dueAt ?? null,
    paidAt: invoice.paidAt ?? null,
    paidTxHash: invoice.metadata.paidTxHash ?? null,
    paidNetwork: invoice.metadata.paidNetwork ?? null,
    payable: reason === null,
    unpayableReason: reason,
  };
}

/** Seller identity printed on an org's invoice and receipt PDFs. */
export async function invoiceMerchant(ctx: AppContext, organizationId: string): Promise<Merchant> {
  const settings = await ctx.orgSettings.get(organizationId);
  return {
    name: settings.orgName,
    ...(settings.supportEmail ? { email: settings.supportEmail } : {}),
  };
}

/**
 * Cancel every still-open checkout session of an invoice (after a void), so
 * a client holding an old link can no longer pay it.
 */
export async function closeInvoiceSessions(ctx: AppContext, invoice: Invoice): Promise<number> {
  let closed = 0;
  for (const id of checkoutSessionIdsOf(invoice)) {
    const session = await ctx.checkouts.findById(id);
    if (session?.status !== "open") continue;
    await ctx.checkouts.save(cancelSession(session));
    closed += 1;
  }
  return closed;
}
