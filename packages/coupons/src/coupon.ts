/**
 * Coupon domain model + the discount engine.
 *
 * All monetary math runs through `@settlekit/common` (bigint USDC base units) —
 * never floating point. A coupon's discount is one of:
 *   - percent       : a whole-percent reduction of the subtotal
 *   - amount         : a fixed Money amount off the subtotal
 *   - free-trial-days: zero monetary discount, but grants N free trial days
 *
 * `applyCoupon` enforces the full eligibility ruleset (status / time window /
 * expiry / global max redemptions / per-customer limit / minimum subtotal /
 * currency match) and returns an immutable result describing the outcome.
 */
import {
  compareMoney,
  fromBaseUnits,
  isPast,
  money,
  subtractMoney,
  toBaseUnits,
  type IsoTimestamp,
  type Money,
} from "@settlekit/common";

/** The kind of reduction a coupon applies. */
export type CouponDiscount =
  | { type: "percent"; percentOff: number }
  | { type: "amount"; amountOff: Money }
  | { type: "free-trial-days"; days: number };

export type CouponStatus = "active" | "archived";

/** A discount coupon. Immutable once created — updates produce new copies. */
export interface Coupon {
  code: string;
  name?: string;
  discount: CouponDiscount;
  currency: Money["currency"];
  status: CouponStatus;
  startsAt?: IsoTimestamp;
  expiresAt?: IsoTimestamp;
  maxRedemptions?: number;
  redeemedCount: number;
  perCustomerLimit?: number;
  minSubtotal?: Money;
  appliesToProductIds?: string[];
}

/** Why a coupon could not be applied. */
export type CouponRejectionReason =
  | "archived"
  | "not_yet_active"
  | "expired"
  | "max_redemptions_reached"
  | "per_customer_limit_reached"
  | "below_min_subtotal"
  | "currency_mismatch";

/** Context that influences eligibility + the resulting discount. */
export interface ApplyCouponOptions {
  now?: Date;
  customerId?: string;
  /** How many times each customer has already redeemed this coupon. */
  priorRedemptionsByCustomer?: Record<string, number>;
}

/** The outcome of attempting to apply a coupon to a subtotal. */
export interface ApplyCouponResult {
  ok: boolean;
  discount: Money;
  total: Money;
  /** Free-trial-days coupons surface the granted days here. */
  freeTrialDays?: number;
  reason?: CouponRejectionReason;
}

/** Normalize a coupon code to its canonical, case-insensitive form. */
export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase().replaceAll(" ", "-");
}

function rejected(subtotal: Money, reason: CouponRejectionReason): ApplyCouponResult {
  return { ok: false, discount: money("0", subtotal.currency), total: subtotal, reason };
}

/** Compute the discount Money for an eligible coupon against `subtotal`. */
function computeDiscount(subtotal: Money, coupon: Coupon): Money {
  if (coupon.discount.type === "amount") {
    // Never discount more than the subtotal itself.
    const cmp = compareMoney(coupon.discount.amountOff, subtotal);
    return cmp >= 0 ? subtotal : coupon.discount.amountOff;
  }
  if (coupon.discount.type === "percent") {
    const base = toBaseUnits(subtotal.amount);
    const discountBase = (base * BigInt(Math.trunc(coupon.discount.percentOff))) / 100n;
    return money(fromBaseUnits(discountBase), subtotal.currency);
  }
  // free-trial-days: no monetary discount.
  return money("0", subtotal.currency);
}

/**
 * Apply a coupon to a subtotal, enforcing every eligibility rule.
 *
 * Returns `{ ok, discount, total, reason? }`. On rejection the discount is zero
 * and `total === subtotal`, with `reason` explaining why. All math is exact
 * (bigint base units); no floating point is involved.
 */
export function applyCoupon(
  subtotal: Money,
  coupon: Coupon,
  options: ApplyCouponOptions = {},
): ApplyCouponResult {
  const now = options.now ?? new Date();

  if (coupon.currency !== subtotal.currency) {
    return rejected(subtotal, "currency_mismatch");
  }
  if (coupon.status !== "active") {
    return rejected(subtotal, "archived");
  }
  if (coupon.startsAt && !isPast(coupon.startsAt, now)) {
    return rejected(subtotal, "not_yet_active");
  }
  if (coupon.expiresAt && isPast(coupon.expiresAt, now)) {
    return rejected(subtotal, "expired");
  }
  if (coupon.maxRedemptions !== undefined && coupon.redeemedCount >= coupon.maxRedemptions) {
    return rejected(subtotal, "max_redemptions_reached");
  }
  if (coupon.perCustomerLimit !== undefined && options.customerId) {
    const prior = options.priorRedemptionsByCustomer?.[options.customerId] ?? 0;
    if (prior >= coupon.perCustomerLimit) {
      return rejected(subtotal, "per_customer_limit_reached");
    }
  }
  if (coupon.minSubtotal && compareMoney(subtotal, coupon.minSubtotal) < 0) {
    return rejected(subtotal, "below_min_subtotal");
  }

  const discount = computeDiscount(subtotal, coupon);
  const total = subtractMoney(subtotal, discount);
  const result: ApplyCouponResult = { ok: true, discount, total };
  if (coupon.discount.type === "free-trial-days") {
    return { ...result, freeTrialDays: Math.trunc(coupon.discount.days) };
  }
  return result;
}

/** True when a coupon would apply to `subtotal` under `options` (no mutation). */
export function validateCoupon(
  subtotal: Money,
  coupon: Coupon,
  options: ApplyCouponOptions = {},
): ApplyCouponResult {
  return applyCoupon(subtotal, coupon, options);
}

/**
 * Immutably increment a coupon's redemption count. Throws when the coupon is
 * archived or already at its global redemption ceiling.
 */
export function redeemCoupon(coupon: Coupon): Coupon {
  if (coupon.status !== "active") {
    throw new Error("coupon is archived");
  }
  if (coupon.maxRedemptions !== undefined && coupon.redeemedCount >= coupon.maxRedemptions) {
    throw new Error("coupon redemption limit reached");
  }
  return { ...coupon, redeemedCount: coupon.redeemedCount + 1 };
}
