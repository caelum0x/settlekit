/**
 * A fetch-based {@link CpnHttpClient} adapter built from {@link CpnCredentials}.
 *
 * IMPORTANT: the Circle Payments Network REST schema is not vendored in this
 * repo. The endpoints, request bodies, and response field names below are a
 * BEST-EFFORT adapter that MUST be confirmed against Circle's official CPN docs
 * before going live. The seam ({@link CpnHttpClient}) is what the provider
 * depends on; swapping this adapter for the verified shape requires no provider
 * changes. The business `reference` is sent as the CPN idempotency key
 * (X-Idempotency-Key header) so a retried payout is deduped server-side.
 */

import { SettleKitError } from "@settlekit/common";
import type {
  CpnCredentials,
  CpnHttpClient,
  CpnPayoutResponse,
  CpnQuoteResponse,
} from "./cpn-provider.js";

/** Minimal fetch surface so this never hard-depends on DOM/Node lib types. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface CpnHttpClientOptions {
  credentials: CpnCredentials;
  /** Override the global fetch (tests / non-Node runtimes). */
  fetchImpl?: FetchLike;
}

function resolveFetch(override?: FetchLike): FetchLike {
  if (override !== undefined) return override;
  const g = globalThis as { fetch?: unknown };
  if (typeof g.fetch !== "function") {
    throw new SettleKitError({
      code: "integration_error",
      message: "global fetch is not available; inject a fetchImpl for the CPN http client",
    });
  }
  return g.fetch as unknown as FetchLike;
}

function authHeaders(credentials: CpnCredentials, idempotencyKey?: string): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${credentials.apiKey}`,
    ...(idempotencyKey !== undefined ? { "x-idempotency-key": idempotencyKey } : {}),
  };
}

async function parseOrThrow(
  response: Awaited<ReturnType<FetchLike>>,
  context: string,
): Promise<unknown> {
  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      detail = "<unreadable body>";
    }
    throw new SettleKitError({
      code: "integration_error",
      message: `CPN ${context} failed with status ${response.status}`,
      retryable: response.status >= 500,
      details: { status: response.status, body: detail.slice(0, 512) },
    });
  }
  return response.json();
}

/** Build a live CPN http client from credentials. */
export function createCpnHttpClient(options: CpnHttpClientOptions): CpnHttpClient {
  const { credentials } = options;
  const fetchImpl = resolveFetch(options.fetchImpl);
  const base = credentials.baseUrl.replace(/\/+$/, "");

  return {
    async requestQuote(input): Promise<CpnQuoteResponse> {
      const response = await fetchImpl(`${base}/v1/cpn/quotes`, {
        method: "POST",
        headers: authHeaders(credentials, input.reference),
        body: JSON.stringify({
          amount: input.amountUsdc,
          sourceCurrency: "USDC",
          destinationCurrency: input.destinationCurrency,
          beneficiaryCountry: input.beneficiaryCountry,
        }),
      });
      const body = (await parseOrThrow(response, "quote")) as Record<string, unknown>;
      return {
        rate: String(body["rate"] ?? "1"),
        destinationAmount: String(body["destinationAmount"] ?? input.amountUsdc),
        feeUsdc: String(body["feeUsdc"] ?? body["fee"] ?? "0"),
        expiresAt: String(body["expiresAt"] ?? new Date(Date.now() + 300_000).toISOString()),
        ...(typeof body["id"] === "string" ? { quoteId: body["id"] } : {}),
      };
    },

    async createPayout(input): Promise<CpnPayoutResponse> {
      const response = await fetchImpl(`${base}/v1/cpn/payouts`, {
        method: "POST",
        headers: authHeaders(credentials, input.idempotencyKey),
        body: JSON.stringify({
          reference: input.reference,
          ...(input.quoteId !== undefined ? { quoteId: input.quoteId } : {}),
          amount: input.amountUsdc,
          sourceCurrency: "USDC",
          destinationCurrency: input.destinationCurrency,
          beneficiary: input.beneficiary,
          ...(input.memo !== undefined ? { memo: input.memo } : {}),
        }),
      });
      const body = (await parseOrThrow(response, "payout")) as Record<string, unknown>;
      return {
        transferId: String(body["id"] ?? body["transferId"] ?? ""),
        status: normalizeStatus(body["status"]),
        destinationAmount: String(body["destinationAmount"] ?? input.amountUsdc),
        ...(typeof body["failureReason"] === "string"
          ? { failureReason: body["failureReason"] }
          : {}),
      };
    },
  };
}

/** Map a raw CPN status string onto our PayoutStatus union (best-effort). */
function normalizeStatus(raw: unknown): CpnPayoutResponse["status"] {
  switch (String(raw).toLowerCase()) {
    case "paid":
    case "complete":
    case "completed":
      return "paid";
    case "failed":
    case "denied":
      return "failed";
    case "returned":
      return "returned";
    case "submitted":
    case "processing":
      return "submitted";
    default:
      return "pending";
  }
}
