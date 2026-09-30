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
  displayCurrency?: string;
  displayAmount?: string;
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

const PROMO_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Open a fresh checkout session for one visit; returns its id. */
export async function startPaymentLink(slug: string, promo?: string): Promise<string> {
  if (!SLUG_RE.test(slug)) throw new PaymentLinkError(404, "This payment link does not exist");
  const code = promo && PROMO_RE.test(promo) ? promo : undefined;
  const data = await call<{ sessionId: string }>(`/v1/public/links/${encodeURIComponent(slug)}/sessions`, {
    method: "POST",
    body: JSON.stringify(code ? { promo: code } : {}),
  });
  return data.sessionId;
}

/**
 * Open a session with the link's promo code; when the code is refused (400),
 * open it at full price instead so the buyer can still pay. Returns the
 * session id and whether the promo was applied.
 */
export async function startPaymentLinkWithPromo(
  slug: string,
  promo: string | undefined,
): Promise<{ sessionId: string; promo: "applied" | "refused" | "none" }> {
  if (!promo) return { sessionId: await startPaymentLink(slug), promo: "none" };
  try {
    return { sessionId: await startPaymentLink(slug, promo), promo: "applied" };
  } catch (error) {
    if (!(error instanceof PaymentLinkError) || error.status !== 400) throw error;
    return { sessionId: await startPaymentLink(slug), promo: "refused" };
  }
}
