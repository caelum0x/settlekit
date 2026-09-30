/**
 * Fiat price display: a price set in a fiat currency (EUR 29) settles in
 * USDC at a live rate that is locked on the checkout session.
 *
 * Rates are "USD per 1 unit of the currency" (ECB reference rates via a
 * self-hosted frankfurter service). USDC is treated as 1 USD. Conversion is
 * exact decimal math, rounded half-up to the cent.
 */
import { fromBaseUnits, toBaseUnits } from "./money.js";

/** Fiat currencies a price may be set in (ECB reference currencies + USD). */
export const FIAT_CURRENCIES = [
  "USD", "EUR", "GBP", "CHF", "CAD", "AUD", "NZD", "JPY", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF",
  "RON", "INR", "BRL", "MXN", "SGD", "HKD", "KRW", "ZAR", "ILS", "IDR", "PHP", "THB", "MYR", "CNY",
] as const;

export type FiatCurrency = (typeof FIAT_CURRENCIES)[number];

export function isFiatCurrency(value: string): value is FiatCurrency {
  return (FIAT_CURRENCIES as readonly string[]).includes(value);
}

/** A rate locked on a checkout session. */
export interface FxQuote {
  currency: FiatCurrency;
  /** Fiat total of the fiat-priced lines, decimal string. */
  amount: string;
  /** USD per 1 unit of `currency`, decimal string. */
  rate: string;
  /** USDC the fiat lines settle for (rounded to the cent). */
  usdcAmount: string;
  /** Where the rate came from, e.g. "ECB via frankfurter". */
  source: string;
  /** Publication date of the reference rate (YYYY-MM-DD). */
  rateDate: string;
  lockedAt: string;
  /** The quote holds until the session expires. */
  expiresAt: string;
}

const RATE_SCALE = 10n ** 10n;
const RATE_RE = /^\d+(\.\d{1,10})?$/;

/** Rate as a bigint scaled by 1e10; throws on malformed or non-positive rates. */
function scaledRate(rate: string): bigint {
  if (!RATE_RE.test(rate)) throw new RangeError(`invalid fx rate: ${rate}`);
  const [whole = "0", frac = ""] = rate.split(".");
  const scaled = BigInt(whole) * RATE_SCALE + BigInt((frac + "0".repeat(10)).slice(0, 10));
  if (scaled <= 0n) throw new RangeError("fx rate must be positive");
  return scaled;
}

/** Convert a fiat amount to USDC at `rate` (USD per unit), half-up to the cent. */
export function fiatToUsdc(amount: string, rate: string): string {
  const base = toBaseUnits(amount); // 6 dp
  if (base < 0n) throw new RangeError("fiat amount must not be negative");
  const usdMicros = (base * scaledRate(rate)) / RATE_SCALE; // 6 dp, truncated
  const CENT = 10_000n; // micro-units per cent
  const cents = (usdMicros + CENT / 2n) / CENT;
  return fromBaseUnits(cents * CENT);
}

/** Render a rate with at most 10 decimals, no trailing zeros. */
export function formatRate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError("fx rate must be a positive number");
  return value.toFixed(10).replace(/\.?0+$/, "");
}

/**
 * The USDC unit amount a price charges: its own `amount`, or, for a fiat
 * price under a session quote in the same currency, the converted value.
 */
export function effectiveUnitAmount(
  price: { amount: string; displayCurrency?: string; displayAmount?: string },
  quote: Pick<FxQuote, "currency" | "rate"> | undefined,
): string {
  if (price.displayCurrency && price.displayAmount && quote && quote.currency === price.displayCurrency) {
    return fiatToUsdc(price.displayAmount, quote.rate);
  }
  return price.amount;
}
