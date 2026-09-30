/**
 * Payable invoices: the metadata bindings that connect an invoice to the
 * public pay page and to the checkout sessions a client pays through.
 *
 * The lifecycle follows the invoice / payment-request model used by open
 * source processors such as BTCPay Server (MIT): an invoice is issued
 * (`open`), exposed through an unguessable public token, paid through a
 * checkout session that expires and can be re-opened, and settled only when a
 * confirmed on-chain payment exists for one of its sessions.
 *
 * Everything here is pure: each helper returns a NEW invoice.
 */
import { toBaseUnits, toIso } from "@settlekit/common";
import { markPaid, type Invoice } from "./invoice.js";

/** Metadata key holding the public pay-page token. */
export const PAY_TOKEN_KEY = "payToken";
/** Metadata key holding every checkout session opened for the invoice. */
export const SESSION_IDS_KEY = "checkoutSessionIds";
/** Metadata key holding the payer's email (where the pay link was sent). */
export const PAYER_EMAIL_KEY = "payerEmail";
/** Metadata key marking an invoice as a platform fee statement. */
export const INVOICE_KIND_KEY = "kind";

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

/** Whether `token` has the shape of a pay token (cheap pre-lookup check). */
export function isPayTokenShape(token: string): boolean {
  return TOKEN_RE.test(token);
}

/** The invoice's public pay token, if it was sent. */
export function payTokenOf(invoice: Invoice): string | undefined {
  const token = invoice.metadata[PAY_TOKEN_KEY];
  return token && token.length > 0 ? token : undefined;
}

/** Bind a pay token (kept when one already exists: links stay stable). */
export function withPayToken(invoice: Invoice, token: string): Invoice {
  if (payTokenOf(invoice) !== undefined) return invoice;
  if (!isPayTokenShape(token)) throw new Error("pay token must be 16-128 url-safe characters");
  return { ...invoice, metadata: { ...invoice.metadata, [PAY_TOKEN_KEY]: token } };
}

/** Record the payer email the link was sent to. */
export function withPayerEmail(invoice: Invoice, email: string): Invoice {
  return { ...invoice, metadata: { ...invoice.metadata, [PAYER_EMAIL_KEY]: email } };
}

/** Every checkout session id opened for this invoice, oldest first. */
export function checkoutSessionIdsOf(invoice: Invoice): string[] {
  const raw = invoice.metadata[SESSION_IDS_KEY];
  return raw ? raw.split(",").filter((id) => id.length > 0) : [];
}

/** The most recently opened checkout session id, if any. */
export function latestCheckoutSessionId(invoice: Invoice): string | undefined {
  const ids = checkoutSessionIdsOf(invoice);
  return ids[ids.length - 1];
}

/** Append a checkout session id (deduplicated; order preserved). */
export function withCheckoutSession(invoice: Invoice, sessionId: string): Invoice {
  if (sessionId.includes(",")) throw new Error("checkout session id must not contain a comma");
  const ids = checkoutSessionIdsOf(invoice).filter((id) => id !== sessionId);
  return {
    ...invoice,
    metadata: { ...invoice.metadata, [SESSION_IDS_KEY]: [...ids, sessionId].join(",") },
  };
}

/** Why an invoice cannot be paid right now, or null when it can. */
export function unpayableReason(invoice: Invoice): string | null {
  if (invoice.status === "paid") return "This invoice is already paid.";
  if (invoice.status === "void") return "This invoice was voided by the seller.";
  if (invoice.status === "uncollectible") return "This invoice is no longer collectible.";
  if (invoice.status === "draft") return "This invoice has not been issued yet.";
  if (toBaseUnits(invoice.total.amount) <= 0n) return "This invoice has nothing to pay.";
  return null;
}

/** The confirmed payment facts recorded on a settled invoice. */
export interface InvoiceSettlement {
  paymentId: string;
  checkoutSessionId: string;
  amount: string;
  network: string;
  txHash?: string;
  confirmedAt?: string;
  /** Organization the payment belongs to; must match the invoice's. */
  organizationId?: string;
}

/**
 * Metadata keys SettleKit owns (pay link, session bindings, settlement facts,
 * fee statement markers). Callers may never set them through the API.
 */
export const RESERVED_INVOICE_METADATA_KEYS: readonly string[] = [
  PAY_TOKEN_KEY,
  SESSION_IDS_KEY,
  PAYER_EMAIL_KEY,
  INVOICE_KIND_KEY,
  "merchantOrgId",
  "period",
  "coverageStart",
  "coverageEnd",
  "paymentId",
  "paidCheckoutSessionId",
  "paidNetwork",
  "paidTxHash",
  "settledAt",
];

/** Caller-supplied metadata without the keys SettleKit owns. */
export function withoutReservedMetadata(metadata: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata ?? {}).filter(([key]) => !RESERVED_INVOICE_METADATA_KEYS.includes(key)),
  );
}

/**
 * Settle an open invoice from a confirmed payment of one of its sessions.
 * Rejects a payment for a foreign session or a short amount, so a cheaper
 * session can never mark a larger invoice paid.
 */
export function settleInvoice(invoice: Invoice, payment: InvoiceSettlement, now: Date = new Date()): Invoice {
  if (!checkoutSessionIdsOf(invoice).includes(payment.checkoutSessionId)) {
    throw new Error("payment does not belong to a checkout session of this invoice");
  }
  if (payment.organizationId !== undefined && payment.organizationId !== invoice.organizationId) {
    throw new Error("payment belongs to another organization");
  }
  if (toBaseUnits(payment.amount) < toBaseUnits(invoice.total.amount)) {
    throw new Error(`payment ${payment.amount} is below the invoice total ${invoice.total.amount}`);
  }
  const paidAt = payment.confirmedAt ? new Date(payment.confirmedAt) : now;
  const paid = markPaid(invoice, Number.isNaN(paidAt.getTime()) ? now : paidAt);
  return {
    ...paid,
    metadata: {
      ...paid.metadata,
      paymentId: payment.paymentId,
      paidCheckoutSessionId: payment.checkoutSessionId,
      paidNetwork: payment.network,
      ...(payment.txHash ? { paidTxHash: payment.txHash } : {}),
      settledAt: toIso(now),
    },
  };
}

/** A confirmed-payment lookup by checkout session (API or worker store). */
export type ConfirmedPaymentLookup = (sessionId: string) => Promise<InvoiceSettlement | undefined>;

/**
 * Reconcile an open invoice against its checkout sessions: the first session
 * with a confirmed payment settles it. Returns the settled invoice, or null
 * when nothing changed (not open, or no confirmed payment yet).
 */
export async function reconcileInvoice(
  invoice: Invoice,
  lookup: ConfirmedPaymentLookup,
  now: Date = new Date(),
): Promise<Invoice | null> {
  if (invoice.status !== "open") return null;
  for (const sessionId of checkoutSessionIdsOf(invoice)) {
    const payment = await lookup(sessionId);
    if (!payment) continue;
    try {
      return settleInvoice(invoice, payment, now);
    } catch {
      // A short or foreign payment never settles the invoice; keep looking.
      continue;
    }
  }
  return null;
}
