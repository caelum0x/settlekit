import type { UsageMeter } from "@settlekit/common";
import { generateId } from "@settlekit/common";
import { periodEnd, toIso } from "@settlekit/common";
import { validationError } from "@settlekit/common";

/** Billing period granularity for a usage meter. */
export type UsagePeriod = "monthly" | "yearly";

/** Input required to open a fresh usage meter for a customer/product/metric. */
export interface CreateMeterInput {
  organizationId: string;
  customerId: string;
  productId: string;
  /** Metric name, e.g. "api_calls". */
  metric: string;
  /** Start of the billing period this meter aggregates within. */
  periodStart: Date;
  /** Period granularity used to derive the period end. */
  period: UsagePeriod;
}

function assertNonEmpty(name: string, value: string): void {
  if (value.trim().length === 0) {
    throw validationError(`${name} must not be empty`);
  }
}

function assertFiniteQuantity(qty: number): void {
  if (!Number.isFinite(qty)) {
    throw validationError("quantity must be a finite number", { qty });
  }
  if (qty < 0) {
    throw validationError("quantity must not be negative", { qty });
  }
}

/**
 * Create a new, empty usage meter for a billing period. The returned aggregate
 * starts at value 0 and carries an explicit period window.
 */
export function createMeter(input: CreateMeterInput): UsageMeter {
  assertNonEmpty("organizationId", input.organizationId);
  assertNonEmpty("customerId", input.customerId);
  assertNonEmpty("productId", input.productId);
  assertNonEmpty("metric", input.metric);

  const end = periodEnd(input.periodStart, input.period);
  return {
    id: generateId("usageMeter"),
    organizationId: input.organizationId,
    customerId: input.customerId,
    productId: input.productId,
    metric: input.metric,
    value: 0,
    periodStart: toIso(input.periodStart),
    periodEnd: toIso(end),
  };
}

/**
 * Record usage against a meter, returning a NEW meter with the quantity added
 * to the running aggregate. The original meter is never mutated.
 *
 * The `metric` is validated to match the meter so callers cannot accidentally
 * record events for the wrong dimension into a shared aggregate.
 */
export function recordUsage(meter: UsageMeter, metric: string, qty: number): UsageMeter {
  assertNonEmpty("metric", metric);
  assertFiniteQuantity(qty);

  if (metric !== meter.metric) {
    throw validationError("metric does not match meter", {
      expected: meter.metric,
      received: metric,
    });
  }

  return {
    ...meter,
    value: meter.value + qty,
  };
}

/**
 * Aggregate the usage recorded across a set of meters for a single period.
 * Only meters whose period window matches the provided window and whose metric
 * matches are summed; mismatched meters are ignored so cross-period leakage is
 * impossible.
 */
export function aggregateForPeriod(
  meters: readonly UsageMeter[],
  metric: string,
  periodStart: string,
  periodEndIso: string,
): number {
  return meters.reduce((sum, meter) => {
    if (meter.metric !== metric) return sum;
    if (meter.periodStart !== periodStart) return sum;
    if (meter.periodEnd !== periodEndIso) return sum;
    return sum + meter.value;
  }, 0);
}

/**
 * Roll a meter into a fresh period, returning a NEW meter with value reset to 0
 * and an advanced period window. Identity (org/customer/product/metric) is
 * preserved; a new meter id is issued for the new period.
 */
export function resetForNewPeriod(
  meter: UsageMeter,
  newPeriodStart: Date,
  period: UsagePeriod,
): UsageMeter {
  return createMeter({
    organizationId: meter.organizationId,
    customerId: meter.customerId,
    productId: meter.productId,
    metric: meter.metric,
    periodStart: newPeriodStart,
    period,
  });
}
