import type { Money, UsageMeter } from "@settlekit/common";
import { multiplyMoney } from "@settlekit/common";
import { validationError } from "@settlekit/common";

/**
 * Compute the usage charge for a meter given the per-unit price.
 *
 * charge = unitAmount * meter.value
 *
 * `unitAmount` is a Money value representing the price of a single metered
 * unit. The aggregate `value` on the meter is the number of units consumed in
 * the period. The result is a Money in the same currency as `unitAmount`.
 */
export function computeUsageCharge(meter: UsageMeter, unitAmount: Money): Money {
  if (!Number.isInteger(meter.value) || meter.value < 0) {
    throw validationError("meter value must be a non-negative integer to bill", {
      value: meter.value,
    });
  }
  return multiplyMoney(unitAmount, meter.value);
}

/**
 * Compute a usage charge with an included free allowance. Only units in excess
 * of `includedUnits` are billed.
 */
export function computeMeteredCharge(
  meter: UsageMeter,
  unitAmount: Money,
  includedUnits: number,
): Money {
  if (!Number.isInteger(includedUnits) || includedUnits < 0) {
    throw validationError("includedUnits must be a non-negative integer", {
      includedUnits,
    });
  }
  if (!Number.isInteger(meter.value) || meter.value < 0) {
    throw validationError("meter value must be a non-negative integer to bill", {
      value: meter.value,
    });
  }
  const billable = Math.max(0, meter.value - includedUnits);
  return multiplyMoney(unitAmount, billable);
}
