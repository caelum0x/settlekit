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
import type { PaymentNetwork } from "@settlekit/common";

import type { AnyTokenOptionsResponse, RouteQuoteView, RouteStatusView } from "./any-token";
import type { EvmPaymentParams } from "./evm-checkout";
import type { HyperCorePaymentParams, HyperCoreStatusResponse } from "./hypercore-checkout";
import type {
  CheckoutSessionView,
  ConfirmPaymentRequest,
  NetworkSelectResponse,
  ReceiptView,
  SolanaPayUrlResponse,
  SolanaStatusResponse,
  SolanaTxResponse,
} from "./types";
import type { ZcashStatusResponse, ZcashUriResponse } from "./zcash-checkout";

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Machine-readable checkout error code, when the server sent one. */
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }

  /** Found on-chain but not final yet: poll again. */
  get pending(): boolean {
    return this.code === "payment_pending";
  }

  /** Paid after the quote expired: held for manual review. */
  get underReview(): boolean {
    return this.code === "payment_under_review";
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
    const code =
      body && typeof body === "object" && "code" in body ? String((body as { code: unknown }).code) : undefined;
    throw new ApiClientError(res.status, message, code);
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

function sessionPath(sessionId: string, leaf: string): string {
  return `/api/v1/checkout-sessions/${encodeURIComponent(sessionId)}/${leaf}`;
}

/** Switch the session to another accepted network (locks a ZEC quote for Zcash). */
export function selectCheckoutNetwork(sessionId: string, network: PaymentNetwork): Promise<NetworkSelectResponse> {
  return request<NetworkSelectResponse>(sessionPath(sessionId, "network"), {
    method: "POST",
    body: JSON.stringify({ network }),
  });
}

/** Wallet parameters for paying on the session's EVM network. */
export function getEvmParams(sessionId: string): Promise<EvmPaymentParams> {
  return request<EvmPaymentParams>(sessionPath(sessionId, "evm/params"));
}

/** Save delivery fields and bind the connected wallet as payer. */
export function declareEvmPayer(
  sessionId: string,
  payer: string,
  fields: Record<string, string>,
): Promise<{ payerAddress: string }> {
  return request<{ payerAddress: string }>(sessionPath(sessionId, "evm/payer"), {
    method: "POST",
    body: JSON.stringify({ payer, fields }),
  });
}

/** Save delivery fields and get the ZIP-321 request for the locked quote. */
export function requestZcashUri(sessionId: string, fields: Record<string, string>): Promise<ZcashUriResponse> {
  return request<ZcashUriResponse>(sessionPath(sessionId, "zcash/uri"), {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
}

/** Poll the session's Zcash payment status. */
export function getZcashStatus(sessionId: string): Promise<ZcashStatusResponse> {
  return request<ZcashStatusResponse>(sessionPath(sessionId, "zcash/status"));
}

/** What the buyer's wallet signs to pay on HyperCore. */
export function getHyperCoreParams(sessionId: string): Promise<HyperCorePaymentParams> {
  return request<HyperCorePaymentParams>(sessionPath(sessionId, "hypercore/params"));
}

/** Submit the buyer-signed usdSend (binds the signer, saves fields). */
export function submitHyperCoreTransfer(
  sessionId: string,
  payload: { action: unknown; signature: string; fields: Record<string, string> },
): Promise<HyperCoreStatusResponse> {
  return request<HyperCoreStatusResponse>(sessionPath(sessionId, "hypercore/submit"), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Poll the submitted HyperCore transfer (settles it once it is in the ledger). */
export function getHyperCoreStatus(sessionId: string, nonce: number): Promise<HyperCoreStatusResponse> {
  return request<HyperCoreStatusResponse>(sessionPath(sessionId, "hypercore/status"), {
    method: "POST",
    body: JSON.stringify({ nonce }),
  });
}

/** Origin chains/tokens the buyer can pay from (any-token routing). */
export function getAnyTokenOptions(sessionId: string): Promise<AnyTokenOptionsResponse> {
  return request<AnyTokenOptionsResponse>(sessionPath(sessionId, "route/quote"));
}

/** Quote an any-token route to the session's network (saves fields). */
export function requestRouteQuote(
  sessionId: string,
  payload: {
    originChainId: number;
    originToken: string;
    originAddress: string;
    depositAddress: boolean;
    fields: Record<string, string>;
  },
): Promise<RouteQuoteView> {
  return request<RouteQuoteView>(sessionPath(sessionId, "route/quote"), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Poll the route; settles the session once the destination transfer verifies. */
export function getRouteStatus(sessionId: string, originTxHash?: string): Promise<RouteStatusView> {
  return request<RouteStatusView>(sessionPath(sessionId, "route/status"), {
    method: "POST",
    body: JSON.stringify(originTxHash ? { originTxHash } : {}),
  });
}
