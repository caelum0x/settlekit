/**
 * Minimal typed fetch helper for the SettleKit API.
 *
 * Normalizes the `{ data } / { error }` envelope into a thrown
 * {@link SettleKitError} on failure, or the unwrapped `data` on success.
 */
import { SettleKitError } from "@settlekit/common";
import type { ApiEnvelope } from "./types.js";

/** Connection details needed to talk to the SettleKit API. */
export interface ApiConnection {
  /** Publishable/secret API key sent as a Bearer token. */
  apiKey: string;
  /** API origin, e.g. `https://api.settlekit.com`. */
  baseUrl: string;
}

export interface ApiRequest {
  /** Path relative to `${baseUrl}/v1`, e.g. `/entitlements/verify`. */
  path: string;
  method?: "GET" | "POST";
  /** JSON body for POST requests. */
  body?: unknown;
  /** Query parameters appended to the URL. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Abort signal for cleanup on unmount. */
  signal?: AbortSignal;
}

function buildUrl(conn: ApiConnection, req: ApiRequest): string {
  const base = conn.baseUrl.replace(/\/+$/, "");
  const path = req.path.startsWith("/") ? req.path : `/${req.path}`;
  const url = new URL(`${base}/v1${path}`);
  if (req.query) {
    for (const [key, value] of Object.entries(req.query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/** Perform a request and return the unwrapped `data`, throwing on `{ error }`. */
export async function apiRequest<T>(conn: ApiConnection, req: ApiRequest): Promise<T> {
  const method = req.method ?? "GET";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${conn.apiKey}`,
    Accept: "application/json",
  };
  if (req.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(buildUrl(conn, req), {
      method,
      headers,
      ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
      ...(req.signal ? { signal: req.signal } : {}),
    });
  } catch (cause) {
    throw new SettleKitError({
      code: "integration_error",
      message: cause instanceof Error ? cause.message : "Network request failed",
      retryable: true,
      cause,
    });
  }

  const envelope = (await response.json().catch(() => undefined)) as
    | ApiEnvelope<T>
    | undefined;

  if (!response.ok || !envelope || envelope.error) {
    const err = envelope?.error;
    throw new SettleKitError({
      code: "integration_error",
      message: err?.message ?? `Request failed with status ${response.status}`,
      httpStatus: response.status,
      ...(err?.details ? { details: err.details } : {}),
    });
  }

  return envelope.data;
}

/** Convert any thrown value into a {@link SettleKitError}. */
export function toSettleKitError(value: unknown): SettleKitError {
  if (SettleKitError.is(value)) return value;
  return new SettleKitError({
    code: "internal_error",
    message: value instanceof Error ? value.message : "Unexpected error",
    cause: value,
  });
}
