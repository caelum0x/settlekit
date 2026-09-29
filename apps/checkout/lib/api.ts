/**
 * Real fetch client for the SettleKit checkout API.
 *
 * Talks HTTP to the route handlers under /api/v1. Works in three contexts:
 *  - Server Components (absolute URL derived from request/env, no-store cache)
 *  - Client Components (relative URL, browser fetch)
 *
 * Every method returns parsed JSON or throws an `ApiClientError` carrying the
 * HTTP status + server message, so callers can branch on 404 (not found) /
 * 410 (expired) without string matching.
 */
import type {
  CheckoutSessionView,
  ConfirmPaymentRequest,
  ReceiptView,
  SolanaPayUrlResponse,
  SolanaStatusResponse,
  SolanaTxResponse,
} from "./types";

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }

  get notFound(): boolean {
    return this.status === 404;
  }

  get expired(): boolean {
    return this.status === 410;
  }
}

/**
 * Resolve the API base URL.
 *  - Browser: relative (empty base) so it hits the same origin.
 *  - Server:  CHECKOUT_API_BASE_URL or a localhost fallback for the dev port.
 */
export function resolveBaseUrl(): string {
  if (typeof window !== "undefined") return "";
  const explicit = process.env.CHECKOUT_API_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const port = process.env.PORT ?? "3000";
  return `http://localhost:${port}`;
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const base = resolveBaseUrl();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(init?.headers ?? {}),
    },
    // Checkout state is dynamic; never serve a cached body.
    cache: "no-store",
  });

  const text = await res.text();
  const body = text.length > 0 ? safeJson(text) : undefined;

  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed with status ${res.status}`;
    throw new ApiClientError(res.status, message);
  }

  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Fetch a checkout session view by id. */
export function getCheckoutSession(
  sessionId: string,
): Promise<CheckoutSessionView> {
  return request<CheckoutSessionView>(
    `/api/v1/checkout-sessions/${encodeURIComponent(sessionId)}`,
  );
}

/** Confirm payment: submit tx hash + collected fields. */
export function confirmCheckoutPayment(
  sessionId: string,
  payload: ConfirmPaymentRequest,
): Promise<ReceiptView> {
  return request<ReceiptView>(
    `/api/v1/checkout-sessions/${encodeURIComponent(sessionId)}/confirm`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

/** Fetch the receipt + delivered access for a completed session. */
export function getReceipt(sessionId: string): Promise<ReceiptView> {
  return request<ReceiptView>(
    `/api/v1/checkout-sessions/${encodeURIComponent(sessionId)}/receipt`,
  );
}

/** Mark a session expired (used by the expired flow). */
export function expireCheckoutSession(
  sessionId: string,
): Promise<{ ok: true }> {
  return request<{ ok: true }>(
    `/api/v1/checkout-sessions/${encodeURIComponent(sessionId)}/expire`,
    { method: "POST" },
  );
}

function solanaPath(sessionId: string, leaf: "pay-url" | "tx" | "status"): string {
  return `/api/v1/checkout-sessions/${encodeURIComponent(sessionId)}/solana/${leaf}`;
}

/** Save buyer fields and get the Solana Pay request (QR + reference) for a session. */
export function requestSolanaPayUrl(
  sessionId: string,
  fields: Record<string, string>,
): Promise<SolanaPayUrlResponse> {
  return request<SolanaPayUrlResponse>(solanaPath(sessionId, "pay-url"), {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
}

/** Ask the server to build the unsigned USDC payment tx for `account`. */
export function requestSolanaTransaction(
  sessionId: string,
  account: string,
): Promise<SolanaTxResponse> {
  return request<SolanaTxResponse>(solanaPath(sessionId, "tx"), {
    method: "POST",
    body: JSON.stringify({ account }),
  });
}

/** Poll whether the session's Solana payment has landed (confirms it if so). */
export function getSolanaStatus(sessionId: string): Promise<SolanaStatusResponse> {
  return request<SolanaStatusResponse>(solanaPath(sessionId, "status"));
}
