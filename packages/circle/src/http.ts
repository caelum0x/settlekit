/**
 * Narrow HTTP transport interface for the Circle REST API plus a real
 * `fetch`-based default implementation.
 *
 * The client logic depends only on this interface, so tests can supply an
 * in-memory `CircleHttp` returning canned JSON to exercise request building,
 * error mapping, and amount normalization without touching the network.
 */
import { SettleKitError } from "@settlekit/common";

/** A single HTTP request the client wants to perform against Circle. */
export interface CircleRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Path beginning with "/", e.g. "/v1/paymentIntents". */
  path: string;
  /** Query string parameters (string values only). */
  query?: Record<string, string | undefined>;
  /** JSON-serializable request body for write methods. */
  body?: unknown;
}

/** The HTTP response surfaced back to the client logic. */
export interface CircleResponse {
  status: number;
  /** Parsed JSON body. `null` when the response had no body. */
  body: unknown;
}

/** Transport seam: one method that performs a request and returns a response. */
export interface CircleHttp {
  request(req: CircleRequest): Promise<CircleResponse>;
}

export interface FetchCircleHttpOptions {
  apiKey: string;
  baseUrl: string;
  /** Injectable fetch (defaults to global fetch). Enables testing/polyfills. */
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
 * `Content-Type: application/json`, and `Accept: application/json`, and parses
 * the JSON response body.
 */
export function createFetchCircleHttp(opts: FetchCircleHttpOptions): CircleHttp {
  const { apiKey, baseUrl } = opts;
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new SettleKitError({
      code: "integration_error",
      message: "global fetch is not available; provide fetchImpl",
    });
  }

  return {
    async request(req: CircleRequest): Promise<CircleResponse> {
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
          message: `Circle request to ${req.method} ${req.path} failed`,
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
