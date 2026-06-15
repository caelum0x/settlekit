/**
 * Redemption records: an immutable log of every successful coupon redemption,
 * used to derive per-customer redemption counts for the per-customer limit.
 */
import { toIso, type IsoTimestamp, type Money } from "@settlekit/common";

/** A single recorded redemption of a coupon. */
export interface CouponRedemption {
  couponCode: string;
  customerId?: string;
  discount: Money;
  redeemedAt: IsoTimestamp;
}

/** Build an immutable redemption record stamped at `now`. */
export function createRedemption(
  couponCode: string,
  discount: Money,
  options: { customerId?: string; now?: Date } = {},
): CouponRedemption {
  return {
    couponCode,
    ...(options.customerId !== undefined ? { customerId: options.customerId } : {}),
    discount,
    redeemedAt: toIso(options.now ?? new Date()),
  };
}

/** Count, per customer id, how many of `redemptions` they account for. */
export function countByCustomer(redemptions: readonly CouponRedemption[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of redemptions) {
    if (!r.customerId) continue;
    counts[r.customerId] = (counts[r.customerId] ?? 0) + 1;
  }
  return counts;
}
