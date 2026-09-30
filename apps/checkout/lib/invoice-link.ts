/**
 * Invoices and payment requests: the checkout side of `/i/<token>`.
 *
 * The pay token is the capability. The API resolves it to a buyer-safe view,
 * opens (or reuses) the invoice's checkout session, and renders the PDF; the
 * session is then paid at `/c/<sessionId>` like any other checkout.
 */
import { apiBaseUrl } from "./payment-link";

export interface PublicInvoice {
  number: string;
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
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

export class InvoiceLinkError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "InvoiceLinkError";
  }
}

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

/** Whether a path segment can be a pay token (checked before any API call). */
export function isInvoiceToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as { data?: T; error?: { message?: string } } | null;
  if (!res.ok || !body?.data) {
    throw new InvoiceLinkError(res.status, body?.error?.message ?? `Invoice unavailable (${res.status})`);
  }
  return body.data;
}

/** The invoice behind a pay token; throws InvoiceLinkError. */
export async function getInvoice(token: string): Promise<PublicInvoice> {
  if (!isInvoiceToken(token)) throw new InvoiceLinkError(404, "This invoice link does not exist");
  return call<PublicInvoice>(`/v1/public/invoices/${encodeURIComponent(token)}`);
}

/** Open (or reuse) the invoice's checkout session; returns its id. */
export async function startInvoicePayment(token: string): Promise<string> {
  if (!isInvoiceToken(token)) throw new InvoiceLinkError(404, "This invoice link does not exist");
  const data = await call<{ sessionId: string }>(`/v1/public/invoices/${encodeURIComponent(token)}/sessions`, {
    method: "POST",
    body: "{}",
  });
  return data.sessionId;
}

/** The API URL of the invoice PDF (proxied by `/i/<token>/pdf`). */
export function invoicePdfApiUrl(token: string): string {
  return `${apiBaseUrl()}/v1/public/invoices/${encodeURIComponent(token)}/pdf`;
}
