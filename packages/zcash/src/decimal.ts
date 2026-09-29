/** Exact decimal-string <-> scaled bigint helpers (no floating point). */

const DECIMAL_RE = /^\d+(\.\d+)?$/;

/**
 * Parse a non-negative decimal string into an integer scaled by 10^`scale`.
 * Extra fractional digits beyond `scale` are truncated (round down).
 */
export function parseScaled(value: string, scale: number): bigint {
  const trimmed = value.trim();
  if (!DECIMAL_RE.test(trimmed)) throw new RangeError(`Invalid decimal: ${JSON.stringify(value)}`);
  const [whole = "0", frac = ""] = trimmed.split(".");
  const padded = (frac + "0".repeat(scale)).slice(0, scale);
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(padded === "" ? "0" : padded);
}

/** Format an integer scaled by 10^`scale` as a trimmed decimal string. */
export function formatScaled(value: bigint, scale: number): string {
  if (value < 0n) throw new RangeError("negative amounts are not supported");
  const unit = 10n ** BigInt(scale);
  const whole = value / unit;
  const frac = (value % unit).toString().padStart(scale, "0").replace(/0+$/, "");
  return frac.length > 0 ? `${whole}.${frac}` : whole.toString();
}

/** Ceiling division for non-negative bigints. */
export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError("division by a non-positive bigint");
  return (numerator + denominator - 1n) / denominator;
}
