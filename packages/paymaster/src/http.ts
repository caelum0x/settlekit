/**
 * Narrow HTTP transport for the Circle Web3 Services REST API (Gas Station
 * policy management) plus a real `fetch`-based default.
 *
 * Mirrors the `CircleHttp` seam in @settlekit/circle: the Gas Station client
 * depends only on this interface, so tests drive request building, error
 * mapping, and response parsing with an in-memory double — no network.
 */
import { SettleKitError } from "@settlekit/common";

/** A single REST request against Circle's Web3 Services API. */
export interface PaymasterRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Path beginning with "/", e.g. "/v1/w3s/gasStation/policies". */
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
}

/** The REST response surfaced back to the client logic. */
export interface PaymasterResponse {
  status: number;
  /** Parsed JSON body. `null` when the response had no body. */
  body: unknown;
}

/** Transport seam: perform a request and return a response. */
export interface PaymasterHttp {
  request(req: PaymasterRequest): Promise<PaymasterResponse>;
}

export interface FetchPaymasterHttpOptions {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

/** Build a fully-qualified URL from a base, path, and query parameters. */
export function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | undefined>,
): string {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${trimmedBase}${normalizedPath}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

/**
 * Real `fetch`-based implementation. Sends `Authorization: Bearer <apiKey>`,
 * `Accept: application/json`, and (for writes) `Content-Type: application/json`,
 * and parses the JSON response body.
 */
export function createFetchPaymasterHttp(opts: FetchPaymasterHttpOptions): PaymasterHttp {
  const { apiKey, baseUrl } = opts;
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new SettleKitError({
      code: "integration_error",
      message: "global fetch is not available; provide fetchImpl",
    });
  }

  return {
    async request(req: PaymasterRequest): Promise<PaymasterResponse> {
      const url = buildUrl(baseUrl, req.path, req.query);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      };
      const hasBody = req.body !== undefined && req.method !== "GET";
      if (hasBody) headers["Content-Type"] = "application/json";

      let res: Response;
      try {
        res = await doFetch(url, {
          method: req.method,
          headers,
          body: hasBody ? JSON.stringify(req.body) : undefined,
        });
      } catch (cause) {
        throw new SettleKitError({
          code: "integration_error",
          message: `Circle Gas Station request to ${req.method} ${req.path} failed`,
          retryable: true,
          cause,
        });
      }

      const text = await res.text();
      let body: unknown = null;
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch (cause) {
          throw new SettleKitError({
            code: "integration_error",
            message: `Circle returned a non-JSON response (status ${res.status})`,
            httpStatus: 502,
            details: { status: res.status, raw: text.slice(0, 2048) },
            cause,
          });
        }
      }

      return { status: res.status, body };
    },
  };
}
