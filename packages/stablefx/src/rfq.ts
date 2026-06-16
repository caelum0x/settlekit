/**
 * StableFX RFQ client (USDC ↔ EURC on Arc) — request/response shapes sourced
 * from Circle's published OpenAPI spec (`developers.circle.com/openapi/stablefx.yaml`).
 *
 * Flow (taker): request a quote → the quote carries the EIP-712 `typedData`
 * (`PermitWitnessTransferFrom` over the trade `Consideration`) the taker signs
 * with their wallet → create a trade with that Permit2 message + signature → the
 * trade settles on-chain through Arc `FxEscrow`. The maker registers its own
 * signature via `/signatures`.
 *
 * Signatures are produced by the relevant wallet (the API never signs); this
 * client transports them. The on-chain settlement ABI + the witness EIP-712
 * types are in `@settlekit/onchain` (read from the verified FxEscrow contract).
 */
import { SettleKitError } from "@settlekit/common";
import type { MintHttp } from "./mint.js";
import { createFetchMintHttp, DEFAULT_CIRCLE_MINT_BASE_URL } from "./mint.js";

/** Settlement schedule for a trade. */
export type Tenor = "instant" | "hourly" | "daily";
/** `tradable` = executable; `reference` = indicative. */
export type QuoteType = "reference" | "tradable";
/** Trade lifecycle (per the StableFX OpenAPI `TradeStatus`). */
export type TradeStatus =
  | "pending"
  | "complete"
  | "confirmed"
  | "pending_settlement"
  | "taker_funded"
  | "maker_funded"
  | "refunded"
  | "breaching"
  | "breached";

/** A currency + amount pair. For a quote, one side carries the known amount. */
export interface CurrencyAmount {
  currency: string;
  amount?: string;
}

/** EIP-712 typed data the taker signs (Permit2 `PermitWitnessTransferFrom`). */
export interface TradeTypedData {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType: "PermitWitnessTransferFrom";
  message: Record<string, unknown>;
}

/** Input to {@link RfqClient.requestQuote} (`POST /quotes`). */
export interface CreateQuoteInput {
  from: CurrencyAmount;
  to: CurrencyAmount;
  tenor: Tenor;
  type?: QuoteType;
  /** Where the bought currency is delivered on-chain. */
  recipientAddress?: string;
}

/** A StableFX quote — includes the EIP-712 `typedData` the taker signs. */
export interface Quote {
  id: string;
  rate: number;
  from: CurrencyAmount;
  to: CurrencyAmount;
  createdAt: string;
  expiresAt: string;
  fee?: string;
  collateral?: string;
  typedData: TradeTypedData;
}

/** Input to {@link RfqClient.createTrade} (`POST /trades`). */
export interface CreateTradeInput {
  quoteId: string;
  /** Taker's on-chain address. */
  address: string;
  /** The Permit2 message from the quote's `typedData.message`. */
  message: unknown;
  /** The taker's signature over the quote `typedData`. */
  signature: string;
  /** UUIDv4 idempotency key. */
  idempotencyKey: string;
}

/** A StableFX trade. */
export interface Trade {
  id: string;
  contractTradeId?: string;
  status: TradeStatus;
  rate: number;
  from: CurrencyAmount;
  to: CurrencyAmount;
  quoteId: string;
  tenor: Tenor;
  settlementTransactionHash?: string;
  maturity?: string | null;
  createDate?: string;
  updateDate?: string;
  completeDate?: string;
}

/** Input to {@link RfqClient.registerMakerSignature} (`POST /signatures`). */
export interface RegisterMakerSignatureInput {
  tradeId: string;
  address: string;
  /** The maker's Permit2 message. */
  details: unknown;
  signature: string;
}

export interface RfqClient {
  /** Request a firm quote (carries the `typedData` to sign). `POST /quotes`. */
  requestQuote(input: CreateQuoteInput): Promise<Quote>;
  /** Submit the taker's signed Permit2 message to create a trade. `POST /trades`. */
  createTrade(input: CreateTradeInput): Promise<Trade>;
  /** List trades. `GET /trades`. */
  listTrades(): Promise<Trade[]>;
  /** Read a trade by id. `GET /trades/:id`. */
  getTrade(tradeId: string): Promise<Trade>;
  /** Register the maker's signature. `POST /signatures`. */
  registerMakerSignature(input: RegisterMakerSignatureInput): Promise<{ tradeId: string }>;
  /** Fetch the typed data to presign for a trade. `GET /signatures/presign/:id`. */
  getPresignData(tradeId: string): Promise<{ typedData: TradeTypedData }>;
}

export interface RfqClientConfig {
  apiKey?: string;
  baseUrl?: string;
  http?: MintHttp;
  fetchImpl?: typeof fetch;
}

const BASE = "/v1/exchange/stablefx";

export function createRfqClient(config: RfqClientConfig): RfqClient {
  const http =
    config.http ??
    createFetchMintHttp({
      apiKey: requireApiKey(config.apiKey),
      baseUrl: config.baseUrl ?? DEFAULT_CIRCLE_MINT_BASE_URL,
      ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
    });

  async function send<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await http.request({ method, path, ...(body !== undefined ? { body } : {}) });
    if (res.status >= 400) {
      throw new SettleKitError({
        code: "integration_error",
        message: `StableFX ${method} ${path} failed (status ${res.status})`,
        httpStatus: 502,
        details: { status: res.status, body: res.body },
      });
    }
    const env = res.body as { data?: T };
    return (env && typeof env === "object" && "data" in env ? env.data : (res.body as T)) as T;
  }

  return {
    requestQuote: (input) => send<Quote>("POST", `${BASE}/quotes`, input),
    createTrade: (input) => send<Trade>("POST", `${BASE}/trades`, input),
    listTrades: () => send<Trade[]>("GET", `${BASE}/trades`),
    getTrade: (tradeId) => send<Trade>("GET", `${BASE}/trades/${encodeURIComponent(tradeId)}`),
    registerMakerSignature: (input) =>
      send<{ tradeId: string }>("POST", `${BASE}/signatures`, input),
    getPresignData: (tradeId) =>
      send<{ typedData: TradeTypedData }>(
        "GET",
        `${BASE}/signatures/presign/${encodeURIComponent(tradeId)}`,
      ),
  };
}

function requireApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new SettleKitError({
      code: "integration_error",
      message: "createRfqClient requires an apiKey (or an injected http transport)",
    });
  }
  return apiKey;
}
