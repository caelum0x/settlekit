/**
 * Live FX rates for fiat-priced products, from a frankfurter service
 * (lineofflight/frankfurter, MIT; ECB reference rates). Self-host it and set
 * FX_RATES_URL, or use the public instance by default. Rates are cached per
 * currency for FX_RATES_TTL_SECONDS (default 600) and sanity-checked; a
 * missing or implausible rate fails closed.
 */
import { SettleKitError, formatRate, type FiatCurrency } from "@settlekit/common";

export interface FxRate {
  /** USD per 1 unit of the currency. */
  rate: string;
  /** Publication date (YYYY-MM-DD). */
  date: string;
  source: string;
}

export interface FxRateSource {
  usdPer(currency: FiatCurrency): Promise<FxRate>;
}

export interface FrankfurterOptions {
  baseUrl?: string;
  ttlMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

const DEFAULT_URL = "https://api.frankfurter.dev/v1";

function unavailable(currency: string, why: string): SettleKitError {
  return new SettleKitError({
    code: "integration_error",
    message: `Prices in ${currency} are temporarily unavailable (${why}). Try again shortly.`,
    httpStatus: 503,
    retryable: true,
  });
}

export function createFrankfurterSource(options: FrankfurterOptions = {}): FxRateSource {
  const baseUrl = (options.baseUrl ?? DEFAULT_URL).replace(/\/+$/, "");
  const ttlMs = options.ttlMs ?? 600_000;
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; value: FxRate }>();

  async function fetchLatest(currency: string): Promise<{ date?: unknown; rates?: Record<string, unknown> } | null> {
    try {
      const res = await doFetch(`${baseUrl}/latest?base=${encodeURIComponent(currency)}&symbols=USD`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw unavailable(currency, `rate service answered ${res.status}`);
      return (await res.json()) as { date?: unknown; rates?: Record<string, unknown> } | null;
    } catch (error) {
      if (error instanceof SettleKitError) throw error;
      throw unavailable(currency, "rate service unreachable");
    }
  }

  return {
    async usdPer(currency) {
      if (currency === "USD") return { rate: "1", date: new Date(now()).toISOString().slice(0, 10), source: "USDC par" };
      const hit = cache.get(currency);
      if (hit && now() - hit.at < ttlMs) return hit.value;
      const body = await fetchLatest(currency);
      const raw = body?.rates?.USD;
      const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
      if (typeof raw !== "number" || !(raw > 0.000001 && raw < 1_000_000) || !date) {
        throw unavailable(currency, "no valid rate");
      }
      const value: FxRate = { rate: formatRate(raw), date, source: "ECB via frankfurter" };
      cache.set(currency, { at: now(), value });
      return value;
    },
  };
}
