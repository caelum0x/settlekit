/**
 * Circle REST client (Gateway / Web3 Services).
 *
 * Wraps the real Circle REST endpoints behind a typed client. All responses
 * are unwrapped from Circle's `{ data }` envelope; non-2xx responses are mapped
 * to a `SettleKitError({ code: "integration_error" })` carrying the Circle error
 * body in `details`. Monetary amounts are normalized into the shared `Money`
 * type so downstream packages can do exact arithmetic.
 */
import { money, normalizeAmount, SettleKitError } from "@settlekit/common";
import type { Money } from "@settlekit/common";
import { createFetchCircleHttp } from "./http.js";
import type { CircleHttp, CircleRequest, CircleResponse } from "./http.js";
import type {
  CircleAmount,
  CircleChain,
  CircleCheckoutCurrency,
  CircleEnvelope,
  CircleErrorBody,
  CirclePaymentIntentResource,
  CirclePaymentIntentStatus,
  CirclePayoutDestination,
  CirclePayoutResource,
  CirclePayoutStatus,
  CircleSettlementCurrency,
  CircleTransferResource,
  CircleTransferStatus,
} from "./types.js";

export const DEFAULT_CIRCLE_BASE_URL = "https://api.circle.com";

export interface CircleClientConfig {
  apiKey: string;
  baseUrl?: string;
  /** Inject a custom transport (defaults to a real fetch-based impl). */
  http?: CircleHttp;
  /** Inject a custom fetch (only used when `http` is not provided). */
  fetchImpl?: typeof fetch;
}

export interface CreatePaymentIntentInput {
  /** Decimal major-unit amount, e.g. "25.50". */
  amount: string;
  currency: CircleCheckoutCurrency;
  settlementCurrency: CircleSettlementCurrency;
  chain: CircleChain;
  /** Optional idempotency key forwarded to Circle. */
  idempotencyKey?: string;
}

export interface CreatePayoutInput {
  /** Decimal major-unit amount to pay out. */
  amount: string;
  currency: CircleSettlementCurrency;
  /** Circle wallet the funds are debited from. */
  sourceWalletId: string;
  destination: CirclePayoutDestination;
  idempotencyKey?: string;
}

export interface ListTransfersInput {
  walletId?: string;
  pageSize?: number;
  pageBefore?: string;
  pageAfter?: string;
}

/** Normalized payment intent returned to SettleKit callers. */
export interface PaymentIntent {
  id: string;
  amount: Money;
  amountPaid?: Money;
  settlementCurrency: CircleSettlementCurrency;
  chains: CircleChain[];
  status: CirclePaymentIntentStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

/** Normalized payout returned to SettleKit callers. */
export interface Payout {
  id: string;
  amount: Money;
  fees?: Money;
  status: CirclePayoutStatus;
  sourceWalletId: string;
  destination: CirclePayoutDestination;
  createdAt: string;
  updatedAt: string;
  trackingRef?: string;
}

/** Normalized transfer returned to SettleKit callers. */
export interface Transfer {
  id: string;
  amount: Money;
  status: CircleTransferStatus;
  transactionHash?: string;
  createdAt: string;
}

export interface CircleClient {
  createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntent>;
  getPaymentIntent(id: string): Promise<PaymentIntent>;
  createPayout(input: CreatePayoutInput): Promise<Payout>;
  getPayout(id: string): Promise<Payout>;
  listTransfers(input?: ListTransfersInput): Promise<Transfer[]>;
}

export function createCircleClient(config: CircleClientConfig): CircleClient {
  if (!config.apiKey) {
    throw new SettleKitError({
      code: "validation_error",
      message: "createCircleClient requires an apiKey",
    });
  }
  const baseUrl = config.baseUrl ?? DEFAULT_CIRCLE_BASE_URL;
  const http =
    config.http ??
    createFetchCircleHttp({ apiKey: config.apiKey, baseUrl, fetchImpl: config.fetchImpl });

  async function send<T>(req: CircleRequest): Promise<T> {
    const res = await http.request(req);
    assertOk(res, req);
    return unwrapData<T>(res.body, req);
  }

  return {
    async createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntent> {
      requireAmount(input.amount, "createPaymentIntent");
      const resource = await send<CirclePaymentIntentResource>({
        method: "POST",
        path: "/v1/paymentIntents",
        body: {
          idempotencyKey: input.idempotencyKey,
          amount: { amount: normalizeAmount(input.amount), currency: input.currency },
          settlementCurrency: input.settlementCurrency,
          paymentMethods: [{ type: "blockchain", chain: input.chain }],
        },
      });
      return normalizePaymentIntent(resource);
    },

    async getPaymentIntent(id: string): Promise<PaymentIntent> {
      requireId(id, "getPaymentIntent");
      const resource = await send<CirclePaymentIntentResource>({
        method: "GET",
        path: `/v1/paymentIntents/${encodeURIComponent(id)}`,
      });
      return normalizePaymentIntent(resource);
    },

    async createPayout(input: CreatePayoutInput): Promise<Payout> {
      requireAmount(input.amount, "createPayout");
      requireId(input.sourceWalletId, "createPayout.sourceWalletId");
      const resource = await send<CirclePayoutResource>({
        method: "POST",
        path: "/v1/payouts",
        body: {
          idempotencyKey: input.idempotencyKey,
          source: { type: "wallet", id: input.sourceWalletId },
          destination: input.destination,
          amount: { amount: normalizeAmount(input.amount), currency: input.currency },
        },
      });
      return normalizePayout(resource);
    },

    async getPayout(id: string): Promise<Payout> {
      requireId(id, "getPayout");
      const resource = await send<CirclePayoutResource>({
        method: "GET",
        path: `/v1/payouts/${encodeURIComponent(id)}`,
      });
      return normalizePayout(resource);
    },

    async listTransfers(input: ListTransfersInput = {}): Promise<Transfer[]> {
      const resources = await send<CircleTransferResource[]>({
        method: "GET",
        path: "/v1/transfers",
        query: {
          walletId: input.walletId,
          pageSize: input.pageSize !== undefined ? String(input.pageSize) : undefined,
          pageBefore: input.pageBefore,
          pageAfter: input.pageAfter,
        },
      });
      return resources.map(normalizeTransfer);
    },
  };
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

function assertOk(res: CircleResponse, req: CircleRequest): void {
  if (res.status >= 200 && res.status < 300) return;
  const errorBody = (res.body ?? {}) as CircleErrorBody;
  const message =
    typeof errorBody.message === "string" && errorBody.message.length > 0
      ? errorBody.message
      : `Circle request ${req.method} ${req.path} failed with status ${res.status}`;
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

function unwrapData<T>(body: unknown, req: CircleRequest): T {
  if (body && typeof body === "object" && "data" in body) {
    return (body as CircleEnvelope<T>).data;
  }
  throw new SettleKitError({
    code: "integration_error",
    message: `Circle response for ${req.method} ${req.path} was missing the data envelope`,
    httpStatus: 502,
    details: { request: { method: req.method, path: req.path }, body },
  });
}

/** Convert a Circle amount into the shared exact-decimal Money type (USDC). */
function toMoney(amount: CircleAmount | undefined): Money | undefined {
  if (!amount) return undefined;
  return money(normalizeAmount(amount.amount), "USDC");
}

function requireMoney(amount: CircleAmount, context: string): Money {
  const m = toMoney(amount);
  if (!m) {
    throw new SettleKitError({
      code: "integration_error",
      message: `Circle ${context} response was missing an amount`,
    });
  }
  return m;
}

function normalizePaymentIntent(r: CirclePaymentIntentResource): PaymentIntent {
  return {
    id: r.id,
    amount: requireMoney(r.amount, "paymentIntent"),
    amountPaid: toMoney(r.amountPaid),
    settlementCurrency: r.settlementCurrency,
    chains: (r.paymentMethods ?? []).map((m) => m.chain),
    status: r.status,
    createdAt: r.createDate,
    updatedAt: r.updateDate,
    expiresAt: r.expiresOn,
  };
}

function normalizePayout(r: CirclePayoutResource): Payout {
  return {
    id: r.id,
    amount: requireMoney(r.amount, "payout"),
    fees: toMoney(r.fees),
    status: r.status,
    sourceWalletId: r.sourceWalletId,
    destination: r.destination,
    createdAt: r.createDate,
    updatedAt: r.updateDate,
    trackingRef: r.trackingRef,
  };
}

function normalizeTransfer(r: CircleTransferResource): Transfer {
  return {
    id: r.id,
    amount: requireMoney(r.amount, "transfer"),
    status: r.status,
    transactionHash: r.transactionHash,
    createdAt: r.createDate,
  };
}
