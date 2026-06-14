/**
 * Money handling for USDC.
 *
 * USDC has 6 decimal places on-chain (1 USDC = 1_000_000 base units).
 * We NEVER use floating point for monetary math. Amounts are represented as
 * decimal strings for display ("25.50") and as bigint base units for arithmetic.
 */

export const USDC_DECIMALS = 6;
export const USDC_SCALE = 1_000_000n; // 10 ** 6

export type Currency = "USDC";

/** A monetary value: a decimal string amount in the major unit + currency. */
export interface Money {
  /** Decimal string in the major unit, e.g. "25.5" or "0.005". */
  amount: string;
  currency: Currency;
}

export function money(amount: string, currency: Currency = "USDC"): Money {
  assertValidAmount(amount);
  return { amount: normalizeAmount(amount), currency };
}

const AMOUNT_RE = /^-?\d+(\.\d+)?$/;

export function assertValidAmount(amount: string): void {
  if (!AMOUNT_RE.test(amount)) {
    throw new RangeError(`Invalid monetary amount: ${JSON.stringify(amount)}`);
  }
  const [, frac = ""] = amount.split(".");
  if (frac.length > USDC_DECIMALS) {
    throw new RangeError(`Amount ${amount} exceeds ${USDC_DECIMALS} decimal places`);
  }
}

/** Convert a decimal major-unit string into bigint base units (6 dp). */
export function toBaseUnits(amount: string): bigint {
  assertValidAmount(amount);
  const negative = amount.startsWith("-");
  const unsigned = negative ? amount.slice(1) : amount;
  const parts = unsigned.split(".");
  const whole = parts[0] ?? "0";
  const frac = parts[1] ?? "";
  const paddedFrac = (frac + "0".repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  const base = BigInt(whole) * USDC_SCALE + BigInt(paddedFrac);
  return negative ? -base : base;
}

/** Convert bigint base units back into a normalized decimal string. */
export function fromBaseUnits(base: bigint): string {
  const negative = base < 0n;
  const abs = negative ? -base : base;
  const whole = abs / USDC_SCALE;
  const frac = abs % USDC_SCALE;
  const fracStr = frac.toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  const result = fracStr.length > 0 ? `${whole}.${fracStr}` : `${whole}`;
  return negative ? `-${result}` : result;
}

/** Normalize an amount string (strip trailing zeros, collapse "-0"). */
export function normalizeAmount(amount: string): string {
  return fromBaseUnits(toBaseUnits(amount));
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: fromBaseUnits(toBaseUnits(a.amount) + toBaseUnits(b.amount)), currency: a.currency };
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: fromBaseUnits(toBaseUnits(a.amount) - toBaseUnits(b.amount)), currency: a.currency };
}

/** Multiply a money value by a non-negative integer quantity (e.g. seats). */
export function multiplyMoney(a: Money, quantity: number): Money {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new RangeError(`quantity must be a non-negative integer, got ${quantity}`);
  }
  return { amount: fromBaseUnits(toBaseUnits(a.amount) * BigInt(quantity)), currency: a.currency };
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  const x = toBaseUnits(a.amount);
  const y = toBaseUnits(b.amount);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function isZero(a: Money): boolean {
  return toBaseUnits(a.amount) === 0n;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}
