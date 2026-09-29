/**
 * Reusable payment links: the checkout side of `/l/<slug>`.
 *
 * The link itself is permanent; the SettleKit API opens a FRESH checkout
 * session per visit (POST /v1/public/links/:slug/sessions) bound to the
 * seller's current networks and receiving addresses. The API and this app
 * share the Postgres store, so the new session is immediately payable at
 * `/c/<sessionId>`.
 */

export interface PaymentLinkSummary {
  slug: string;
  productId: string;
  name: string;
  description: string;
  merchantName: string;
  priceUsd: string;
  interval: string;
  networks: { network: string; name: string; asset: string; env: string }[];
}

export class PaymentLinkError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PaymentLinkError";
  }
}

/** Base URL of the SettleKit API (server-side). */
export function apiBaseUrl(): string {
  const url = process.env.SETTLEKIT_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
  return url.replace(/\/+$/, "");
}

const SLUG_RE = /^[a-z0-9-]{4,64}$/;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as { data?: T; error?: { message?: string } } | null;
  if (!res.ok || !body?.data) {
    throw new PaymentLinkError(res.status, body?.error?.message ?? `Payment link unavailable (${res.status})`);
  }
  return body.data;
}

/** Product + price + networks behind a link; throws PaymentLinkError. */
export async function getPaymentLink(slug: string): Promise<PaymentLinkSummary> {
  if (!SLUG_RE.test(slug)) throw new PaymentLinkError(404, "This payment link does not exist");
  return call<PaymentLinkSummary>(`/v1/public/links/${encodeURIComponent(slug)}`);
}

/** Open a fresh checkout session for one visit; returns its id. */
export async function startPaymentLink(slug: string): Promise<string> {
  if (!SLUG_RE.test(slug)) throw new PaymentLinkError(404, "This payment link does not exist");
  const data = await call<{ sessionId: string }>(`/v1/public/links/${encodeURIComponent(slug)}/sessions`, {
    method: "POST",
    body: "{}",
  });
  return data.sessionId;
}
