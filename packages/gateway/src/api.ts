/**
 * Narrow HTTP transport for the Circle Gateway API plus a real `fetch`-based
 * default and response parsers.
 *
 * The Gateway API serves two off-chain operations SettleKit needs:
 *   - `POST /v1/transfer`  → an attestation for a signed burn intent (mint).
 *   - `POST /v1/balances`  → the unified balance across domains for a depositor.
 *
 * All domain logic depends only on the {@link GatewayHttp} seam, so tests inject
 * an in-memory transport returning canned JSON.
 */

import { SettleKitError } from "@settlekit/common";
import type {
  Hex,
  SignedBurnIntent,
  TransferAttestation,
} from "./types.js";

/** Testnet Gateway API base URL. */
export const GATEWAY_API_TESTNET_BASE_URL = "https://gateway-api-testnet.circle.com";
/** Mainnet Gateway API base URL. */
export const GATEWAY_API_MAINNET_BASE_URL = "https://gateway-api.circle.com";

/** A single HTTP request against the Gateway API. */
export interface GatewayRequest {
  method: "GET" | "POST";
  /** Path beginning with "/", e.g. "/v1/transfer". */
  path: string;
  /** Query parameters (string values only). */
  query?: Record<string, string | undefined>;
  /** JSON-serializable request body. */
  body?: unknown;
}

/** The HTTP response surfaced back to the client logic. */
export interface GatewayResponse {
  status: number;
  /** Parsed JSON body, or `null` when the response had no body. */
  body: unknown;
}

/** Transport seam: one method that performs a request and returns a response. */
export interface GatewayHttp {
  request(req: GatewayRequest): Promise<GatewayResponse>;
}

export interface FetchGatewayHttpOptions {
  baseUrl: string;
  /** Optional Gateway API key (sent as `Authorization: Bearer`). */
  apiKey?: string;
  /** Injectable fetch (defaults to global fetch). */
  fetchImpl?: typeof fetch;
}

/** Build a fully-qualified URL from a base, path, and query parameters. */
export function buildGatewayUrl(
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
 * Real `fetch`-based {@link GatewayHttp}. Sends `Accept: application/json`, a
 * JSON body for writes, and a bearer token when an API key is configured.
 */
export function createFetchGatewayHttp(opts: FetchGatewayHttpOptions): GatewayHttp {
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new SettleKitError({
      code: "integration_error",
      message: "Gateway: global fetch is not available; provide fetchImpl",
    });
  }

  return {
    async request(req: GatewayRequest): Promise<GatewayResponse> {
      const url = buildGatewayUrl(opts.baseUrl, req.path, req.query);
      const headers: Record<string, string> = { Accept: "application/json" };
      if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
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
          message: `Gateway request to ${req.method} ${req.path} failed`,
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
            message: `Gateway returned a non-JSON response (status ${res.status})`,
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

/** Raise a SettleKitError for any non-2xx Gateway response. */
export function assertGatewayOk(res: GatewayResponse, req: GatewayRequest): void {
  if (res.status >= 200 && res.status < 300) return;
  const errBody = (res.body ?? {}) as { message?: string; code?: unknown };
  const message =
    typeof errBody.message === "string" && errBody.message.length > 0
      ? errBody.message
      : `Gateway request ${req.method} ${req.path} failed with status ${res.status}`;
  throw new SettleKitError({
    code: "integration_error",
    message,
    httpStatus: 502,
    retryable: res.status >= 500 || res.status === 429,
    details: {
      status: res.status,
      request: { method: req.method, path: req.path },
      gatewayError: res.body,
    },
  });
}

/** A hex value the Gateway API returns for attestation/signature fields. */
function requireHex(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new SettleKitError({
      code: "integration_error",
      message: `Gateway response field ${field} was not a 0x-prefixed hex string`,
      httpStatus: 502,
      details: { field, value },
    });
  }
  return value as Hex;
}

/**
 * Parse a `POST /v1/transfer` response into a {@link TransferAttestation}.
 * Validates the load-bearing `attestation` and `signature` fields and carries
 * through the optional fee/expiry metadata.
 */
export function parseTransferAttestation(body: unknown): TransferAttestation {
  if (!body || typeof body !== "object") {
    throw new SettleKitError({
      code: "integration_error",
      message: "Gateway transfer response was not an object",
      httpStatus: 502,
      details: { body },
    });
  }
  const raw = body as Record<string, unknown>;
  const result: TransferAttestation = {
    transferId: typeof raw.transferId === "string" ? raw.transferId : "",
    attestation: requireHex(raw.attestation, "attestation"),
    signature: requireHex(raw.signature, "signature"),
  };
  if (raw.fees && typeof raw.fees === "object") {
    result.fees = raw.fees as TransferAttestation["fees"];
  }
  if (typeof raw.expirationBlock === "string") {
    result.expirationBlock = raw.expirationBlock;
  }
  return result;
}

/** One `{ domain, depositor }` source entry for a balances query. */
export interface BalanceSource {
  domain: number;
  /** 20-byte EVM depositor address. */
  depositor: string;
}

/** A per-domain balance entry as returned by `POST /v1/balances`. */
export interface ApiDomainBalance {
  domain: number;
  /** Available unified balance on this domain, as a decimal USDC string. */
  balance: string;
}

/** Parse a `POST /v1/balances` response into per-domain balance entries. */
export function parseApiBalances(body: unknown): ApiDomainBalance[] {
  if (!body || typeof body !== "object" || !Array.isArray((body as Record<string, unknown>).balances)) {
    throw new SettleKitError({
      code: "integration_error",
      message: "Gateway balances response was missing the balances array",
      httpStatus: 502,
      details: { body },
    });
  }
  const balances = (body as { balances: unknown[] }).balances;
  return balances.map((entry, i) => {
    if (!entry || typeof entry !== "object") {
      throw new SettleKitError({
        code: "integration_error",
        message: `Gateway balances[${i}] was not an object`,
        httpStatus: 502,
        details: { entry },
      });
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.domain !== "number" || typeof e.balance !== "string") {
      throw new SettleKitError({
        code: "integration_error",
        message: `Gateway balances[${i}] missing domain/balance`,
        httpStatus: 502,
        details: { entry },
      });
    }
    return { domain: e.domain, balance: e.balance };
  });
}

/** The Gateway off-chain API operations SettleKit uses. */
export interface GatewayApi {
  /**
   * Request an attestation for one or more signed burn intents. Circle accepts
   * up to 16 intents per request; pass `enableForwarder` to route via the
   * Gateway forwarding service.
   */
  requestTransferAttestation(
    intents: SignedBurnIntent[],
    options?: { enableForwarder?: boolean },
  ): Promise<TransferAttestation>;
  /** Read the available unified balance per domain for the given sources. */
  getBalances(token: string, sources: BalanceSource[]): Promise<ApiDomainBalance[]>;
}

/** Create a {@link GatewayApi} over an injected {@link GatewayHttp} transport. */
export function createGatewayApi(http: GatewayHttp): GatewayApi {
  return {
    async requestTransferAttestation(
      intents: SignedBurnIntent[],
      options: { enableForwarder?: boolean } = {},
    ): Promise<TransferAttestation> {
      if (!Array.isArray(intents) || intents.length === 0) {
        throw new SettleKitError({
          code: "validation_error",
          message: "Gateway: requestTransferAttestation requires at least one signed burn intent",
        });
      }
      if (intents.length > 16) {
        throw new SettleKitError({
          code: "validation_error",
          message: "Gateway: a transfer request may contain at most 16 burn intents",
        });
      }
      const req: GatewayRequest = {
        method: "POST",
        path: "/v1/transfer",
        query: options.enableForwarder ? { enableForwarder: "true" } : undefined,
        body: intents,
      };
      const res = await http.request(req);
      assertGatewayOk(res, req);
      return parseTransferAttestation(res.body);
    },

    async getBalances(
      token: string,
      sources: BalanceSource[],
    ): Promise<ApiDomainBalance[]> {
      if (typeof token !== "string" || token.length === 0) {
        throw new SettleKitError({
          code: "validation_error",
          message: "Gateway: getBalances requires a token symbol",
        });
      }
      if (!Array.isArray(sources) || sources.length === 0) {
        throw new SettleKitError({
          code: "validation_error",
          message: "Gateway: getBalances requires at least one source",
        });
      }
      const req: GatewayRequest = {
        method: "POST",
        path: "/v1/balances",
        body: { token, sources },
      };
      const res = await http.request(req);
      assertGatewayOk(res, req);
      return parseApiBalances(res.body);
    },
  };
}
