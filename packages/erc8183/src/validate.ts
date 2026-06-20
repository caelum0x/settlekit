/**
 * Boundary validation for ERC-8183 job requests. Each validator returns a
 * `SettleKitError` describing the first problem, or `null` when the input is
 * well-formed. Client methods short-circuit to `err(...)` so no malformed
 * request ever reaches the port / chain.
 */

import { type SettleKitError, validationError } from "@settlekit/common";

/** Decimal amount with up to 6 fractional digits (USDC precision). */
const AMOUNT_RE = /^\d+(\.\d{1,6})?$/;

/** Validate a positive decimal amount string. */
export function validateAmount(amount: string, field = "amountUsdc"): SettleKitError | null {
  if (typeof amount !== "string" || amount.length === 0) {
    return validationError(`${field} is required`, { field });
  }
  if (!AMOUNT_RE.test(amount)) {
    return validationError(`${field} must be a decimal with up to 6 places`, { field, amount });
  }
  if (Number(amount) <= 0) {
    return validationError(`${field} must be greater than zero`, { field, amount });
  }
  return null;
}

/** Validate a non-empty trimmed string (addresses, URIs, ids). */
export function validateNonEmpty(value: string, field: string): SettleKitError | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return validationError(`${field} is required`, { field });
  }
  return null;
}

/** Validate a non-empty wallet address (alias of {@link validateNonEmpty}). */
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
