/**
 * Pure StableFX quote math.
 *
 * All Arc stablecoins (USDC, EURC, USYC) expose a 6-decimal ERC-20 interface,
 * so we reuse the currency-agnostic 6dp base-unit helpers from
 * `@settlekit/common` (`toBaseUnits` / `fromBaseUnits`) and do every conversion
 * with exact integer arithmetic — never floating point.
 *
 * A rate like "0.923456" is itself a 6-or-fewer-decimal value; we scale it to
 * base units too, so `sell_base * rate_base / 1e6` yields the gross quote-side
 * base amount, then apply fees and a single rounding step.
 */

import { SettleKitError, toBaseUnits, fromBaseUnits } from "@settlekit/common";
import type {
  FxQuote,
  FxQuoteInput,
  FxRate,
  FxRounding,
  StableAmount,
  StableCurrency,
} from "./types.js";

/** 6-decimal scale shared by every Arc stablecoin and by the rate encoding. */
const SCALE = 1_000_000n;

/**
 * Compute an FX quote locally from a known rate, with exact 6-decimal math.
 *
 * `gross = sell * rate`, `fee = gross * feeRate`, `buy = gross − fee`. The rate
 * and fee fractions are encoded at 6 decimals; the single rounding step is
 * applied when reducing the intermediate 12-decimal products back to 6 dp.
 */
export function computeFxQuote(input: FxQuoteInput): FxQuote {
  const { sell, rate } = input;
  assertRateMatchesSell(rate, sell);

  const rounding: FxRounding = input.rounding ?? "half_even";
  const feeRate = input.feeRate ?? "0";

  const sellBase = parsePositiveBase(sell.amount, "sell amount");
  const rateBase = parsePositiveBase(rate.rate, "rate");
  const feeBase = parseFraction(feeRate, "feeRate");

  // gross_base (6dp) = sell_base (6dp) * rate_base (6dp) / SCALE, rounded once.
  const grossBase = scaleDown(sellBase * rateBase, rounding);

  // fee_base (6dp) = gross_base (6dp) * feeRate_base (6dp) / SCALE, rounded once.
  const feeAmountBase = scaleDown(grossBase * feeBase, rounding);
  const buyBase = grossBase - feeAmountBase;

  const quoteCurrency = rate.quote;
  return {
    sell,
    gross: toStableAmount(grossBase, quoteCurrency),
    fee: toStableAmount(feeAmountBase, quoteCurrency),
    buy: toStableAmount(buyBase, quoteCurrency),
    rate,
  };
}

/**
 * Invert an FX rate so it quotes the other direction, preserving 6-decimal
 * precision. `1 / rate` is computed in base units: `SCALE * SCALE / rate_base`.
 */
export function invertFxRate(rate: FxRate, rounding: FxRounding = "half_even"): FxRate {
  const rateBase = parsePositiveBase(rate.rate, "rate");
  const invertedBase = divRound(SCALE * SCALE, rateBase, rounding);
  return {
    base: rate.quote,
    quote: rate.base,
    rate: fromBaseUnits(invertedBase),
  };
}

/** Build a {@link StableAmount} from a 6dp base-unit bigint. */
function toStableAmount(base: bigint, currency: StableCurrency): StableAmount {
  return { amount: fromBaseUnits(base), currency };
}

/** Reduce a 12-decimal product (two 6dp factors) back to 6dp with rounding. */
function scaleDown(product: bigint, rounding: FxRounding): bigint {
  return divRound(product, SCALE, rounding);
}

/**
 * Integer division `numerator / denominator` with the requested rounding.
 * Inputs are non-negative (amounts/rates are validated positive).
 */
function divRound(numerator: bigint, denominator: bigint, rounding: FxRounding): bigint {
  if (denominator <= 0n) {
    throw new SettleKitError({
      code: "validation_error",
      message: "FX division by non-positive denominator",
    });
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;

  switch (rounding) {
    case "floor":
      return quotient;
    case "ceil":
      return quotient + 1n;
    case "half_even": {
      const twice = remainder * 2n;
      if (twice < denominator) return quotient;
      if (twice > denominator) return quotient + 1n;
      // Exactly half: round to even.
      return quotient % 2n === 0n ? quotient : quotient + 1n;
    }
  }
}

/** Parse a positive decimal string into 6dp base units. */
function parsePositiveBase(value: string, label: string): bigint {
  let base: bigint;
  try {
    base = toBaseUnits(value);
  } catch (cause) {
    throw new SettleKitError({
      code: "validation_error",
      message: `Invalid ${label}: ${JSON.stringify(value)}`,
      cause,
    });
  }
  if (base <= 0n) {
    throw new SettleKitError({
      code: "validation_error",
      message: `${label} must be positive, got ${JSON.stringify(value)}`,
    });
  }
  return base;
}

/** Parse a non-negative fee fraction (0 allowed) into 6dp base units. */
function parseFraction(value: string, label: string): bigint {
  let base: bigint;
  try {
    base = toBaseUnits(value);
  } catch (cause) {
    throw new SettleKitError({
      code: "validation_error",
      message: `Invalid ${label}: ${JSON.stringify(value)}`,
      cause,
    });
  }
  if (base < 0n) {
    throw new SettleKitError({
      code: "validation_error",
      message: `${label} must be non-negative, got ${JSON.stringify(value)}`,
    });
  }
  return base;
}

/** Guard that the rate's base currency matches what is being sold. */
function assertRateMatchesSell(rate: FxRate, sell: StableAmount): void {
  if (rate.base !== sell.currency) {
    throw new SettleKitError({
      code: "validation_error",
      message: `Rate base ${rate.base} does not match sell currency ${sell.currency}`,
    });
  }
  if (rate.quote === rate.base) {
    throw new SettleKitError({
      code: "validation_error",
      message: `FX rate base and quote must differ (got ${rate.base})`,
    });
  }
}
