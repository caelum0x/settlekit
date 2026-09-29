/**
 * Minimal JSON-over-HTTP helper for the hand-written provider clients, plus
 * the typed {@link RouteError}. `fetch` is injectable so tests replay recorded
 * provider responses without network access.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type RouteErrorCode =
  /** The provider refused the request (bad params, blocked wallet, amount too low, no liquidity). */
  | "provider_rejected"
  /** Timeout, 5xx, network failure or unreadable body: nothing was quoted. */
  | "provider_unavailable"
  | "rate_limited"
  /** The provider cannot do this destination/origin/mode. */
  | "unsupported"
  /** The quote breaks the checkout's fee / slippage / origin / destination policy. */
  | "policy_violation"
  /** Every provider failed or was refused. */
  | "no_route";

export class RouteError extends Error {
  readonly code: RouteErrorCode;
  /** Provider-specific error code (e.g. Relay `AMOUNT_TOO_LOW`). */
  readonly providerCode: string | undefined;

  constructor(code: RouteErrorCode, message: string, providerCode?: string) {
    super(message);
    this.name = "RouteError";
    this.code = code;
    this.providerCode = providerCode;
  }
}

export function isRouteError(error: unknown): error is RouteError {
  return error instanceof RouteError;
}

export interface JsonRequest {
  fetch: FetchLike;
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  /** Provider name for error messages. */
  provider: string;
}

function messageOf(body: unknown, status: number): { message: string; code?: string } {
  if (body !== null && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message : undefined;
    const code =
      typeof record.errorCode === "string" ? record.errorCode : typeof record.code === "number" || typeof record.code === "string" ? String(record.code) : undefined;
    if (message !== undefined) return { message, ...(code !== undefined ? { code } : {}) };
  }
  return { message: `HTTP ${status}` };
}

/** Send a JSON request; throws {@link RouteError} for every failure. */
export async function requestJson(request: JsonRequest): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  let response: Response;
  try {
    response = await request.fetch(request.url, {
      method: request.method,
      headers: {
        accept: "application/json",
        ...(request.body !== undefined ? { "content-type": "application/json" } : {}),
        ...request.headers,
      },
      ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new RouteError("provider_unavailable", `${request.provider} unreachable: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
  let body: unknown;
  try {
    const text = await response.text();
    body = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    throw new RouteError("provider_unavailable", `${request.provider} returned an unreadable response (HTTP ${response.status})`);
  }
  if (response.ok) return body;
  const { message, code } = messageOf(body, response.status);
  if (response.status === 429) throw new RouteError("rate_limited", `${request.provider} rate limit: ${message}`, code);
  if (response.status >= 500) throw new RouteError("provider_unavailable", `${request.provider} error: ${message}`, code);
  throw new RouteError("provider_rejected", `${request.provider}: ${message}`, code);
}

/** Narrow unknown JSON to an object record (throws provider_unavailable). */
export function asRecord(value: unknown, what: string, provider: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RouteError("provider_unavailable", `${provider} returned an unexpected ${what}`);
  }
  return value as Record<string, unknown>;
}

export function optString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function optNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
}
