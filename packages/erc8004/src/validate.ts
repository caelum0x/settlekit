/**
 * Boundary validation for ERC-8004 requests, mirroring app-kit's `validate.ts`.
 * Each validator returns a `SettleKitError` describing the first problem, or
 * `null` when the input is well-formed. Client methods short-circuit to
 * `err(...)` so no malformed request ever reaches the port / chain.
 */

import { type SettleKitError, validationError } from "@settlekit/common";

/** Validate a non-empty, non-blank string field. */
export function validateNonEmpty(value: string, field: string): SettleKitError | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return validationError(`${field} is required`, { field });
  }
  return null;
}

/**
 * Validate an integer within an inclusive range. Relies on
 * {@link Number.isInteger} so `NaN`/`Infinity`/fractions are rejected (range
 * comparisons alone would let `NaN` slip through).
 */
export function validateIntInRange(
  value: number,
  min: number,
  max: number,
  field: string,
): SettleKitError | null {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return validationError(`${field} must be an integer`, { field, value });
  }
  if (value < min || value > max) {
    return validationError(`${field} must be between ${min} and ${max}`, {
      field,
      value,
      min,
      max,
    });
  }
  return null;
}

/**
 * Maximum reputation score this package enforces. The on-chain `score` type is
 * `int128`, but the documented convention (see {@link ./types.js}) is 0–100.
 * We require an integer in 0..100 here; consumers needing the wider int128
 * range can validate it in their own port implementation.
 */
const MAX_SCORE = 100;

/** Validate a reputation score: an integer in the inclusive range 0..100. */
export function validateScore(score: number, field = "score"): SettleKitError | null {
  return validateIntInRange(score, 0, MAX_SCORE, field);
}

/** Validate a non-empty wallet address (shape checking is the port's job). */
export function validateAddress(address: string, field = "address"): SettleKitError | null {
  return validateNonEmpty(address, field);
}

/** Return the first non-null error from a list of checks, or null. */
export function firstError(
  ...checks: readonly (SettleKitError | null)[]
): SettleKitError | null {
  for (const check of checks) {
    if (check !== null) return check;
  }
  return null;
}
