/**
 * Narrow HTTP transport for Circle's Compliance Engine REST API plus a real
 * `fetch`-based default. Mirrors the seam used by `@settlekit/circle-wallets`:
 * client logic depends only on {@link ComplianceHttp}, so tests inject an
 * in-memory transport returning canned JSON.
 *
 * Circle wraps successful responses in a `{ data: ... }` envelope and
 * authenticates with `Authorization: Bearer <apiKey>`.
 *
 * Source: https://developers.circle.com/wallets/compliance-engine/tx-screening
 */
import { SettleKitError } from "@settlekit/common";

export interface ComplianceRequest {
  method: "GET" | "POST";
  /** Path beginning with "/", e.g. "/v1/w3s/compliance/screening/addresses". */
  path: string;
  body?: unknown;
}

export interface ComplianceResponse {
  status: number;
  /** Parsed JSON body. `null` when the response had no body. */
  body: unknown;
}

/** Transport seam: one method that performs a request and returns a response. */
export interface ComplianceHttp {
  request(req: ComplianceRequest): Promise<ComplianceResponse>;
}

export interface FetchComplianceHttpOptions {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

function buildUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Real `fetch`-based implementation. */
export function createFetchComplianceHttp(opts: FetchComplianceHttpOptions): ComplianceHttp {
  const { apiKey, baseUrl } = opts;
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new SettleKitError({
      code: "integration_error",
      message: "global fetch is not available; provide fetchImpl",
    });
  }

  return {
    async request(req: ComplianceRequest): Promise<ComplianceResponse> {
      const url = buildUrl(baseUrl, req.path);
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
          message: `Circle compliance request to ${req.method} ${req.path} failed`,
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
            message: `Circle compliance returned a non-JSON response (status ${res.status})`,
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
