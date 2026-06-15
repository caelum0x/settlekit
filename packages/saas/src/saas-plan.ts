/**
 * SaaS plan definitions (plan §4, §20).
 *
 * A {@link SaasPlan} is the pricing/entitlement template a tenant subscribes to.
 * Its `features` map encodes both boolean flags (e.g. `sso: true`) and numeric
 * limits (e.g. `projects: 10`). `seats` is the included seat allotment.
 *
 * This module is pure: plan creation and listing perform no I/O.
 */
import { generateId, validationError, ok, err } from "@settlekit/common";
import type { Money, Result, SettleKitError } from "@settlekit/common";

/** Billing cadence for a SaaS plan. */
export type PlanInterval = "monthly" | "yearly";

/**
 * A subscribable SaaS plan template.
 *
 * `features` values are either booleans (flags) or numbers (limits). A numeric
 * value of `-1` denotes "unlimited" so that gates can distinguish an explicit
 * unlimited grant from a zero/absent limit.
 */
export interface SaasPlan {
  id: string;
  /** Product this plan belongs to. */
  productId: string;
  name: string;
  interval: PlanInterval;
  /** Recurring price charged each interval. */
  price: Money;
  /** Feature flags (boolean) and limits (number). `-1` means unlimited. */
  features: Record<string, boolean | number>;
  /** Number of seats included in the plan. */
  seats: number;
  createdAt: string;
}

/** Sentinel value used in numeric feature limits to mean "unlimited". */
export const UNLIMITED = -1;

/** Input accepted by {@link createPlan}. */
export interface CreatePlanInput {
  productId: string;
  name: string;
  interval: PlanInterval;
  price: Money;
  features?: Record<string, boolean | number>;
  seats?: number;
  now?: Date;
}

/**
 * Create a validated {@link SaasPlan}. Returns a `Result` rather than throwing
 * so callers at the API boundary can surface validation errors cleanly.
 */
export function createPlan(input: CreatePlanInput): Result<SaasPlan, SettleKitError> {
  const name = input.name.trim();
  if (name.length === 0) {
    return err(validationError("Plan name must not be empty"));
  }
  if (input.productId.trim().length === 0) {
    return err(validationError("Plan productId must not be empty"));
  }
  const seats = input.seats ?? 1;
  if (!Number.isInteger(seats) || seats < 0) {
    return err(validationError("Plan seats must be a non-negative integer", { seats }));
  }

  const features = input.features ?? {};
  for (const [key, value] of Object.entries(features)) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      return err(validationError(`Feature ${key} must be a finite number`, { key, value }));
    }
  }

  const now = input.now ?? new Date();
  const plan: SaasPlan = {
    id: generateId("price"),
    productId: input.productId,
    name,
    interval: input.interval,
    price: input.price,
    // Copy to break aliasing with the caller's object (immutability).
    features: { ...features },
    seats,
    createdAt: now.toISOString(),
  };
  return ok(plan);
}

/**
 * List plans, optionally filtered by product. Returns a new array sorted by
 * creation time (oldest first) without mutating the input.
 */
export function listPlans(
  plans: readonly SaasPlan[],
  options: { productId?: string } = {},
): SaasPlan[] {
  return plans
    .filter((p) => (options.productId ? p.productId === options.productId : true))
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
