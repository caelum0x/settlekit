/**
 * Narrow HTTP transport for Circle's Web3 Services (W3S) REST API plus a real
 * `fetch`-based default implementation.
 *
 * Mirrors the seam used by `@settlekit/circle` (`CircleHttp` /
 * `createFetchCircleHttp`): the client logic depends only on the
 * `WalletsHttp` interface, so tests can inject an in-memory transport that
 * returns canned JSON to exercise request building, envelope unwrapping, and
 * error mapping without touching the network.
 *
 * Circle W3S wraps every successful response in a top-level `{ data: ... }`
 * envelope and authenticates with `Authorization: Bearer <apiKey>`.
 *
 * Source: https://developers.circle.com/w3s (Developer-Controlled Wallets).
 */
import { SettleKitError } from "@settlekit/common";

/** A single HTTP request the wallets client wants to perform against Circle. */
export interface WalletsRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Path beginning with "/", e.g. "/v1/w3s/wallets". */
  path: string;
  /** Query string parameters (string values only; `undefined` is dropped). */
  query?: Record<string, string | undefined>;
  /** JSON-serializable request body for write methods. */
  body?: unknown;
  /** Extra request headers (e.g. `X-User-Token` for user-controlled wallets). */
  headers?: Record<string, string>;
}

/** The HTTP response surfaced back to the client logic. */
export interface WalletsResponse {
  status: number;
  /** Parsed JSON body. `null` when the response had no body. */
  body: unknown;
}

/** Transport seam: one method that performs a request and returns a response. */
export interface WalletsHttp {
  request(req: WalletsRequest): Promise<WalletsResponse>;
}

export interface FetchWalletsHttpOptions {
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
 * `Content-Type: application/json` (on writes), and `Accept: application/json`,
 * and parses the JSON response body.
 */
export function createFetchWalletsHttp(opts: FetchWalletsHttpOptions): WalletsHttp {
  const { apiKey, baseUrl } = opts;
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new SettleKitError({
      code: "integration_error",
      message: "global fetch is not available; provide fetchImpl",
    });
  }

  return {
    async request(req: WalletsRequest): Promise<WalletsResponse> {
      const url = buildUrl(baseUrl, req.path, req.query);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      };
      const hasBody = req.body !== undefined && req.method !== "GET";
      if (hasBody) headers["Content-Type"] = "application/json";
      if (req.headers) Object.assign(headers, req.headers);

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
          message: `Circle W3S request to ${req.method} ${req.path} failed`,
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
            message: `Circle W3S returned a non-JSON response (status ${res.status})`,
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
