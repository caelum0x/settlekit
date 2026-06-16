/**
 * Circle Mint REST integration: mint and redeem USDC/EURC.
 *
 * Uses Circle's `/v1/businessAccount/*` surface — minting a stablecoin delivers
 * it to a verified blockchain address via a *transfer*, and redeeming off-ramps
 * to fiat via a *payout*. Responses are unwrapped from Circle's `{ data }`
 * envelope and normalized into {@link Mint} / {@link Redeem}.
 *
 * The transport is the injectable {@link MintHttp} seam (mirroring
 * `@settlekit/circle`'s `CircleHttp`) so request-building and response-parsing
 * are unit-testable with an in-memory client.
 *
 * Docs: https://developers.circle.com/circle-mint/quickstarts/mint-and-redeem
 */

import { SettleKitError } from "@settlekit/common";
import type {
  CreateMintInput,
  CreateRedeemInput,
  Mint,
  MintChain,
  MintStatus,
  Redeem,
  RedeemStatus,
  StableAmount,
  StableCurrency,
} from "./types.js";

export const DEFAULT_CIRCLE_MINT_BASE_URL = "https://api.circle.com";

/** A single HTTP request against the Circle Mint REST API. */
export interface MintRequest {
  method: "GET" | "POST";
  /** Path beginning with "/", e.g. "/v1/businessAccount/transfers". */
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
}

/** The HTTP response surfaced back to the mint client logic. */
export interface MintResponse {
  status: number;
  /** Parsed JSON body; `null` when the response had no body. */
  body: unknown;
}

/** Transport seam: performs a request and returns a response. */
export interface MintHttp {
  request(req: MintRequest): Promise<MintResponse>;
}

export interface FetchMintHttpOptions {
  apiKey: string;
  baseUrl: string;
  /** Injectable fetch (defaults to global fetch). */
  fetchImpl?: typeof fetch;
}

/** Build a fully-qualified URL from base, path, and query parameters. */
export function buildMintUrl(
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
 * Real `fetch`-based {@link MintHttp}. Sends `Authorization: Bearer <apiKey>`,
 * `Accept: application/json`, and (for writes) `Content-Type: application/json`.
 */
export function createFetchMintHttp(opts: FetchMintHttpOptions): MintHttp {
  const { apiKey, baseUrl } = opts;
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new SettleKitError({
      code: "integration_error",
      message: "global fetch is not available; provide fetchImpl",
    });
  }

  return {
    async request(req: MintRequest): Promise<MintResponse> {
      const url = buildMintUrl(baseUrl, req.path, req.query);
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
          message: `Circle Mint request to ${req.method} ${req.path} failed`,
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
            message: `Circle Mint returned a non-JSON response (status ${res.status})`,
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

/* ------------------------------------------------------------------ */
/* Raw Circle Mint resource shapes (inside the `{ data }` envelope)    */
/* ------------------------------------------------------------------ */

interface MintAmount {
  amount: string;
  currency: string;
}

interface MintTransferResource {
  id: string;
  amount: MintAmount;
  status: MintStatus;
  destination?: {
    type?: string;
    address?: string;
    addressId?: string;
    chain?: MintChain;
  };
  transactionHash?: string;
  createDate: string;
  updateDate: string;
}

interface MintPayoutResource {
  id: string;
  amount: MintAmount;
  status: RedeemStatus;
  sourceWalletId?: string;
  trackingRef?: string;
  createDate: string;
  updateDate: string;
}

interface MintErrorBody {
  code?: number | string;
  message?: string;
}

/* ------------------------------------------------------------------ */
/* Mint client                                                        */
/* ------------------------------------------------------------------ */

export interface MintClient {
  createMint(input: CreateMintInput): Promise<Mint>;
  getMint(id: string): Promise<Mint>;
  createRedeem(input: CreateRedeemInput): Promise<Redeem>;
  getRedeem(id: string): Promise<Redeem>;
}

export interface MintClientConfig {
  apiKey?: string;
  baseUrl?: string;
  http?: MintHttp;
  fetchImpl?: typeof fetch;
}

/** Create a Circle Mint client over an injectable {@link MintHttp}. */
export function createMintClient(config: MintClientConfig): MintClient {
  const baseUrl = config.baseUrl ?? DEFAULT_CIRCLE_MINT_BASE_URL;
  const http =
    config.http ??
    createFetchMintHttp({
      apiKey: requireApiKey(config.apiKey),
      baseUrl,
      fetchImpl: config.fetchImpl,
    });

  async function send<T>(req: MintRequest): Promise<T> {
    const res = await http.request(req);
    assertOk(res, req);
    return unwrapData<T>(res.body, req);
  }

  return {
    async createMint(input: CreateMintInput): Promise<Mint> {
      requireAmount(input.amount, "createMint");
      requireId(input.destinationAddressId, "createMint.destinationAddressId");
      const resource = await send<MintTransferResource>({
        method: "POST",
        path: "/v1/businessAccount/transfers",
        body: {
          idempotencyKey: input.idempotencyKey,
          destination: {
            type: "verified_blockchain",
            addressId: input.destinationAddressId,
          },
          amount: { amount: input.amount, currency: input.currency },
        },
      });
      return normalizeMint(resource);
    },

    async getMint(id: string): Promise<Mint> {
      requireId(id, "getMint");
      const resource = await send<MintTransferResource>({
        method: "GET",
        path: `/v1/businessAccount/transfers/${encodeURIComponent(id)}`,
      });
      return normalizeMint(resource);
    },

    async createRedeem(input: CreateRedeemInput): Promise<Redeem> {
      requireAmount(input.amount, "createRedeem");
      requireId(input.bankAccountId, "createRedeem.bankAccountId");
      const resource = await send<MintPayoutResource>({
        method: "POST",
        path: "/v1/businessAccount/payouts",
        body: {
          idempotencyKey: input.idempotencyKey,
          destination: { type: "wire", id: input.bankAccountId },
          amount: { amount: input.amount, currency: input.currency },
        },
      });
      return normalizeRedeem(resource);
    },

    async getRedeem(id: string): Promise<Redeem> {
      requireId(id, "getRedeem");
      const resource = await send<MintPayoutResource>({
        method: "GET",
        path: `/v1/businessAccount/payouts/${encodeURIComponent(id)}`,
      });
      return normalizeRedeem(resource);
    },
  };
}

function requireApiKey(apiKey: string | undefined): string {
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new SettleKitError({
      code: "validation_error",
      message: "createMintClient requires an apiKey (or an injected http)",
    });
  }
  return apiKey;
}

function requireAmount(amount: string, op: string): void {
  if (typeof amount !== "string" || amount.length === 0) {
    throw new SettleKitError({ code: "validation_error", message: `${op} requires an amount` });
  }
}

function requireId(id: string, op: string): void {
  if (typeof id !== "string" || id.length === 0) {
    throw new SettleKitError({ code: "validation_error", message: `${op} requires an id` });
  }
}

function assertOk(res: MintResponse, req: MintRequest): void {
  if (res.status >= 200 && res.status < 300) return;
  const errorBody = (res.body ?? {}) as MintErrorBody;
  const message =
    typeof errorBody.message === "string" && errorBody.message.length > 0
      ? errorBody.message
      : `Circle Mint request ${req.method} ${req.path} failed with status ${res.status}`;
  throw new SettleKitError({
    code: "integration_error",
    message,
    httpStatus: 502,
    retryable: res.status >= 500 || res.status === 429,
    details: {
      status: res.status,
      request: { method: req.method, path: req.path },
      circleError: res.body,
    },
  });
}

function unwrapData<T>(body: unknown, req: MintRequest): T {
  if (body && typeof body === "object" && "data" in body) {
    return (body as { data: T }).data;
  }
  throw new SettleKitError({
    code: "integration_error",
    message: `Circle Mint response for ${req.method} ${req.path} was missing the data envelope`,
    httpStatus: 502,
    details: { request: { method: req.method, path: req.path }, body },
  });
}

function toStableAmount(amount: MintAmount, context: string): StableAmount {
  const currency = amount.currency;
  if (currency !== "USDC" && currency !== "EURC") {
    throw new SettleKitError({
      code: "integration_error",
      message: `Circle Mint ${context} returned unsupported currency ${JSON.stringify(currency)}`,
    });
  }
  return { amount: amount.amount, currency: currency as StableCurrency };
}

function normalizeMint(r: MintTransferResource): Mint {
  return {
    id: r.id,
    amount: toStableAmount(r.amount, "mint"),
    status: r.status,
    chain: r.destination?.chain,
    destinationAddress: r.destination?.address,
    transactionHash: r.transactionHash,
    createdAt: r.createDate,
    updatedAt: r.updateDate,
  };
}

function normalizeRedeem(r: MintPayoutResource): Redeem {
  return {
    id: r.id,
    amount: toStableAmount(r.amount, "redeem"),
    status: r.status,
    sourceWalletId: r.sourceWalletId,
    trackingRef: r.trackingRef,
    createdAt: r.createDate,
    updatedAt: r.updateDate,
  };
}
