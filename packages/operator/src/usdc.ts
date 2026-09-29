/**
 * USDC conversions at the operator's trust boundaries (model tool input, HTTP
 * bodies, invoice extraction). Internally every amount is bigint base units.
 */
import { fromBaseUnits, toBaseUnits } from "@settlekit/common";

const DECIMAL_RE = /^\d{1,15}(\.\d{1,6})?$/;

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountError";
  }
}

/** Parse a positive decimal USDC string ("12.5") into base units. */
export function parseUsdc(value: string): bigint {
  const trimmed = value.trim();
  if (!DECIMAL_RE.test(trimmed)) {
    throw new AmountError(`"${value}" is not a USDC amount with at most 6 decimals`);
  }
  const base = toBaseUnits(trimmed);
  if (base <= 0n) throw new AmountError("amount must be positive");
  return base;
}

/** Format base units as a decimal USDC string. */
export function formatUsdc(base: bigint): string {
  return fromBaseUnits(base);
}

/** Recursively render bigints as decimal USDC strings for model/API output. */
export function usdcView(value: unknown): unknown {
  if (typeof value === "bigint") return formatUsdc(value);
  if (Array.isArray(value)) return value.map(usdcView);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, usdcView(v)]));
  }
  return value;
}
