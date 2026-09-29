/**
 * USD -> ZEC quote locking.
 *
 * Prices come from Coinbase (primary) and Kraken (fallback) through an
 * injected `fetch`, so tests run on recorded responses. When both answer,
 * a >3% disagreement aborts the quote (one feed is wrong or manipulated).
 * The locked amount is ceil(usd / rate · 1e8) zatoshis plus the session tag,
 * valid for 15 minutes by default.
 */

import type { SettlementQuote } from "@settlekit/common";
import { ceilDiv, formatScaled, parseScaled } from "./decimal.js";
import { ZCASH_DECIMALS } from "./network.js";

export type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface PriceObservation {
  /** USD per ZEC, decimal string. */
  rate: string;
  source: string;
  observedAt: Date;
}

export interface PriceSource {
  readonly name: string;
  fetchUsdPrice(): Promise<PriceObservation>;
}

export class QuoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteError";
  }
}

export const COINBASE_ZEC_SPOT_URL = "https://api.coinbase.com/v2/prices/ZEC-USD/spot";
export const KRAKEN_ZEC_TICKER_URL = "https://api.kraken.com/0/public/Ticker?pair=ZECUSD";
export const DEFAULT_QUOTE_TTL_SEC = 900;
export const DEFAULT_MAX_DIVERGENCE_BPS = 300;
export const DEFAULT_MAX_PRICE_AGE_SEC = 60;
const RATE_SCALE = 8;

async function getJson(fetchImpl: FetchLike, url: string, source: string): Promise<unknown> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new QuoteError(`${source} price request failed with HTTP ${res.status}`);
  return res.json();
}

function positiveRate(value: unknown, source: string): string {
  if (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value) || parseScaled(value, RATE_SCALE) === 0n) {
    throw new QuoteError(`${source} returned an invalid ZEC price`);
  }
  return value;
}

/** Coinbase spot price: `{ data: { amount, base: "ZEC", currency: "USD" } }`. */
export function createCoinbaseSource(fetchImpl: FetchLike, now: () => Date = () => new Date()): PriceSource {
  return {
    name: "coinbase",
    async fetchUsdPrice() {
      const body = (await getJson(fetchImpl, COINBASE_ZEC_SPOT_URL, "coinbase")) as {
        data?: { amount?: unknown; base?: unknown; currency?: unknown };
      };
      if (body.data?.base !== "ZEC" || body.data.currency !== "USD") {
        throw new QuoteError("coinbase returned an unexpected pair");
      }
      return { rate: positiveRate(body.data.amount, "coinbase"), source: "coinbase", observedAt: now() };
    },
  };
}

/** Kraken ticker: `{ error: [], result: { <pair>: { c: [lastPrice, lotVolume] } } }`. */
export function createKrakenSource(fetchImpl: FetchLike, now: () => Date = () => new Date()): PriceSource {
  return {
    name: "kraken",
    async fetchUsdPrice() {
      const body = (await getJson(fetchImpl, KRAKEN_ZEC_TICKER_URL, "kraken")) as {
        error?: unknown[];
        result?: Record<string, { c?: unknown[] }>;
      };
      if (Array.isArray(body.error) && body.error.length > 0) {
        throw new QuoteError(`kraken error: ${String(body.error[0])}`);
      }
      const pair = body.result ? Object.values(body.result)[0] : undefined;
      return { rate: positiveRate(pair?.c?.[0], "kraken"), source: "kraken", observedAt: now() };
    },
  };
}

export interface LockQuoteParams {
  /** USD amount owed, decimal string (the session total). */
  usdAmount: string;
  /** Amount tag in zatoshis (see ./tag.ts). */
  tag: number;
  /** Primary source first; later sources are fallbacks and cross-checks. */
  sources: readonly PriceSource[];
  now: Date;
  ttlSec?: number;
  maxDivergenceBps?: number;
  maxPriceAgeSec?: number;
}

function divergenceBps(a: bigint, b: bigint): bigint {
  const low = a < b ? a : b;
  const diff = a > b ? a - b : b - a;
  return (diff * 10_000n) / low;
}

async function observe(sources: readonly PriceSource[]): Promise<PriceObservation[]> {
  const settled = await Promise.allSettled(sources.map((source) => source.fetchUsdPrice()));
  return settled.flatMap((entry) => (entry.status === "fulfilled" ? [entry.value] : []));
}

/** Zatoshis owed for `usdAmount` at `rate` (ceil), before the tag. */
export function usdToZats(usdAmount: string, rate: string): bigint {
  const usd = parseScaled(usdAmount, RATE_SCALE);
  const price = parseScaled(rate, RATE_SCALE);
  if (price === 0n) throw new QuoteError("ZEC price must be positive");
  return ceilDiv(usd * 10n ** BigInt(ZCASH_DECIMALS), price);
}

/** Lock a ZEC quote for a USD amount. Throws {@link QuoteError} on bad prices. */
export async function lockQuote(params: LockQuoteParams): Promise<SettlementQuote> {
  if (params.sources.length === 0) throw new QuoteError("no ZEC price sources configured");
  if (!Number.isInteger(params.tag) || params.tag < 0) throw new QuoteError("tag must be a non-negative integer");
  const observations = await observe(params.sources);
  const primary = observations[0];
  if (primary === undefined) throw new QuoteError("all ZEC price sources failed");

  const maxAgeMs = (params.maxPriceAgeSec ?? DEFAULT_MAX_PRICE_AGE_SEC) * 1000;
  for (const entry of observations) {
    if (params.now.getTime() - entry.observedAt.getTime() > maxAgeMs) {
      throw new QuoteError(`${entry.source} ZEC price is stale`);
    }
  }
  const maxBps = BigInt(params.maxDivergenceBps ?? DEFAULT_MAX_DIVERGENCE_BPS);
  const primaryRate = parseScaled(primary.rate, RATE_SCALE);
  for (const other of observations.slice(1)) {
    if (divergenceBps(primaryRate, parseScaled(other.rate, RATE_SCALE)) > maxBps) {
      throw new QuoteError(`ZEC price sources disagree: ${primary.source} ${primary.rate} vs ${other.source} ${other.rate}`);
    }
  }

  const amountBase = usdToZats(params.usdAmount, primary.rate) + BigInt(params.tag);
  const ttlMs = (params.ttlSec ?? DEFAULT_QUOTE_TTL_SEC) * 1000;
  return {
    asset: "ZEC",
    amountBase: amountBase.toString(),
    decimals: 8,
    rate: formatScaled(primaryRate, RATE_SCALE),
    source: primary.source,
    lockedAt: params.now.toISOString(),
    expiresAt: new Date(params.now.getTime() + ttlMs).toISOString(),
  };
}
