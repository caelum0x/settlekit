/**
 * Boundary validation for App Kit requests. Each validator returns a
 * `SettleKitError` describing the first problem, or `null` when the input is
 * well-formed. Operations short-circuit to `err(...)` so no malformed request
 * ever reaches the SDK / chain.
 */

import { type SettleKitError, validationError } from "@settlekit/common";
import {
  SUPPORTED_CHAINS,
  SUPPORTED_TOKENS,
  type SupportedChain,
  type SupportedToken,
} from "./types.js";

/** Decimal amount with up to 6 fractional digits (USDC precision). */
const AMOUNT_RE = /^\d+(\.\d{1,6})?$/;

/** Validate a positive decimal amount string. */
export function validateAmount(amount: string, field = "amount"): SettleKitError | null {
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

/** Validate that a chain is in the supported allow-list. */
export function validateChain(chain: string, field = "chain"): SettleKitError | null {
  if (!SUPPORTED_CHAINS.includes(chain as SupportedChain)) {
    return validationError(`unsupported ${field}: ${chain}`, {
      field,
      chain,
      supported: SUPPORTED_CHAINS,
    });
  }
  return null;
}

/** Validate that a token is in the supported allow-list. */
export function validateToken(token: string, field = "token"): SettleKitError | null {
  if (!SUPPORTED_TOKENS.includes(token as SupportedToken)) {
    return validationError(`unsupported ${field}: ${token}`, {
      field,
      token,
      supported: SUPPORTED_TOKENS,
    });
  }
  return null;
}

/** Maximum basis points (100%). */
const MAX_BPS = 10000;

/**
 * Validate a basis-points value: an integer in the inclusive range 0..10000.
 * Relies on {@link Number.isInteger} so `NaN`/`Infinity`/fractions are rejected
 * (range comparisons alone would let `NaN` slip through).
 */
export function validateBps(value: number, field: string): SettleKitError | null {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return validationError(`${field} must be an integer`, { field, value });
  }
  if (value < 0 || value > MAX_BPS) {
    return validationError(`${field} must be between 0 and ${MAX_BPS} basis points`, {
      field,
      value,
    });
  }
  return null;
}

/** Validate a non-empty wallet address. */
export function validateAddress(address: string, field = "address"): SettleKitError | null {
  if (typeof address !== "string" || address.trim().length === 0) {
    return validationError(`${field} is required`, { field });
  }
  return null;
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
