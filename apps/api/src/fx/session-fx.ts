/**
 * Lock a live FX rate on a checkout session for fiat-priced lines. The line
 * prices are converted to USDC before totals, promo and tax are computed,
 * so the session amount (what onchain verification expects) is in USDC and
 * the quote holds for the session lifetime.
 */
import {
  fiatToUsdc,
  fromBaseUnits,
  toBaseUnits,
  isFiatCurrency,
  toIso,
  validationError,
  type FxQuote,
  type Price,
} from "@settlekit/common";
import type { PricedLineItem } from "@settlekit/payments";
import type { FxRateSource } from "./rates.js";

export interface FxPricing {
  items: PricedLineItem[];
  quote?: FxQuote;
}

/** Whether a price is set in a fiat currency other than USD. */
export function isFiatPrice(price: Price): boolean {
  return price.displayCurrency !== undefined && price.displayAmount !== undefined && price.displayCurrency !== "USD";
}

/**
 * Convert fiat-priced lines to USDC at one live rate. All fiat lines of a
 * session must share a currency (USDC-priced lines are left as they are).
 */
export async function lockFx(
  rates: FxRateSource,
  items: readonly PricedLineItem[],
  expiresAt: string,
  now: Date = new Date(),
): Promise<FxPricing> {
  const fiat = items.filter((i) => isFiatPrice(i.price));
  if (fiat.length === 0) return { items: [...items] };
  const currencies = new Set(fiat.map((i) => i.price.displayCurrency!));
  if (currencies.size > 1) throw validationError("items priced in different currencies cannot share one checkout");
  const currency = [...currencies][0]!;
  if (!isFiatCurrency(currency)) throw validationError(`unsupported price currency: ${currency}`);
  const { rate, date, source } = await rates.usdPer(currency);

  let fiatTotal = 0n;
  let usdcTotal = 0n;
  const converted = items.map((item) => {
    if (!isFiatPrice(item.price)) return item;
    const unit = fiatToUsdc(item.price.displayAmount!, rate);
    const qty = BigInt(item.lineItem.quantity);
    fiatTotal += toBaseUnits(item.price.displayAmount!) * qty;
    usdcTotal += toBaseUnits(unit) * qty;
    return { ...item, price: { ...item.price, amount: unit } };
  });
  const quote: FxQuote = {
    currency,
    amount: fromBaseUnits(fiatTotal),
    rate,
    usdcAmount: fromBaseUnits(usdcTotal),
    source,
    rateDate: date,
    lockedAt: toIso(now),
    expiresAt,
  };
  return { items: converted, quote };
}

/** Attach the locked quote to a drafted session (valid until it expires). */
export function withFx<T extends { expiresAt: string }>(session: T, quote: FxQuote | undefined): T & { fxQuote?: FxQuote } {
  return quote ? { ...session, fxQuote: { ...quote, expiresAt: session.expiresAt } } : session;
}
