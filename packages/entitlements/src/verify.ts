import type { Entitlement } from "@settlekit/common";

/** Result of a feature / seat verification check. */
export interface VerifyResult {
  allowed: boolean;
  /** Machine-readable reason when `allowed` is false. */
  reason?: string;
  /** The resolved feature value, when applicable (boolean flag or numeric limit). */
  value?: boolean | number | string;
}

/**
 * Verify that an entitlement grants access to a named feature.
 *
 * A feature is granted when its value in `entitlement.features` is either the
 * boolean `true` or a numeric limit greater than zero. A string value is treated
 * as an enum/plan tier and is considered granted when present and non-empty.
 */
export function verifyFeature(entitlement: Entitlement, feature: string): VerifyResult {
  const features = entitlement.features;
  if (!features || !(feature in features)) {
    return { allowed: false, reason: "feature_not_granted" };
  }
  const value = features[feature];
  if (value === undefined) {
    return { allowed: false, reason: "feature_not_granted" };
  }

  if (typeof value === "boolean") {
    return value
      ? { allowed: true, value }
      : { allowed: false, reason: "feature_disabled", value };
  }

  if (typeof value === "number") {
    return value > 0
      ? { allowed: true, value }
      : { allowed: false, reason: "limit_exhausted", value };
  }

  // string tier value
  return value.length > 0
    ? { allowed: true, value }
    : { allowed: false, reason: "feature_disabled", value };
}

/**
 * Check that an entitlement has at least `amount` credits remaining. Pure read —
 * does not mutate. Use `deductCredits` to spend.
 */
export function verifyCredits(entitlement: Entitlement, amount: number): VerifyResult {
  assertPositiveAmount(amount);
  const remaining = entitlement.creditsRemaining ?? 0;
  if (remaining < amount) {
    return { allowed: false, reason: "insufficient_credits", value: remaining };
  }
  return { allowed: true, value: remaining };
}

/**
 * Check that adding usage stays within the entitlement's seat allotment.
 * `usedSeats` is the count already in use (excluding the seat being requested).
 */
export function checkSeat(entitlement: Entitlement, usedSeats: number): VerifyResult {
  if (!Number.isInteger(usedSeats) || usedSeats < 0) {
    return { allowed: false, reason: "invalid_seat_count" };
  }
  const limit = entitlement.seats;
  if (limit === undefined) {
    return { allowed: false, reason: "no_seat_allotment" };
  }
  if (usedSeats >= limit) {
    return { allowed: false, reason: "seat_limit_reached", value: limit };
  }
  return { allowed: true, value: limit - usedSeats };
}

export function assertPositiveAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new RangeError(`amount must be a positive number, got ${String(amount)}`);
  }
}
