import type { UsageMeter } from "@settlekit/common";
import { validationError } from "@settlekit/common";

/** Result of evaluating a usage meter against a hard limit. */
export interface LimitCheck {
  /** Whether the current value is within the limit (value <= limit). */
  withinLimit: boolean;
  /** Whether the current value has reached or exceeded the limit. */
  exceeded: boolean;
  /** Units remaining before the limit is hit (clamped at 0). */
  remaining: number;
  /** The current aggregated value of the meter. */
  value: number;
  /** The configured limit. */
  limit: number;
}

/**
 * Evaluate a meter's current aggregate against a hard usage limit.
 *
 * A meter is "within limit" while its value is less than or equal to the limit,
 * and "exceeded" once the value is strictly greater than the limit.
 */
export function checkLimit(meter: UsageMeter, limit: number): LimitCheck {
  if (!Number.isFinite(limit) || limit < 0) {
    throw validationError("limit must be a non-negative finite number", { limit });
  }

  const value = meter.value;
  const exceeded = value > limit;
  return {
    withinLimit: value <= limit,
    exceeded,
    remaining: Math.max(0, limit - value),
    value,
    limit,
  };
}

/**
 * Whether recording an additional `qty` would keep the meter within `limit`.
 * Useful as a pre-flight guard before calling recordUsage.
 */
export function wouldExceedLimit(meter: UsageMeter, limit: number, qty: number): boolean {
  if (!Number.isFinite(qty) || qty < 0) {
    throw validationError("qty must be a non-negative finite number", { qty });
  }
  return checkLimit({ ...meter, value: meter.value + qty }, limit).exceeded;
}
