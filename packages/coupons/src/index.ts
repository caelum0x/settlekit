import { fromBaseUnits, toBaseUnits, type Money } from "@settlekit/common";

export type CouponDiscount = { type: "percent"; percentOff: number } | { type: "amount"; amountOff: Money };

export interface Coupon {
  code: string;
  discount: CouponDiscount;
  active: boolean;
  maxRedemptions?: number;
  redeemedCount: number;
}

export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase().replaceAll(" ", "-");
}

export function applyCoupon(subtotal: Money, coupon: Coupon): Money {
  if (!coupon.active) return subtotal;
  if (coupon.maxRedemptions !== undefined && coupon.redeemedCount >= coupon.maxRedemptions) return subtotal;
  const subtotalBase = toBaseUnits(subtotal.amount);
  const discountBase =
    coupon.discount.type === "percent"
      ? (subtotalBase * BigInt(coupon.discount.percentOff)) / 100n
      : toBaseUnits(coupon.discount.amountOff.amount);
  const next = subtotalBase - discountBase;
  return { amount: fromBaseUnits(next > 0n ? next : 0n), currency: subtotal.currency };
}

export function redeemCoupon(coupon: Coupon): Coupon {
  if (!coupon.active) throw new Error("coupon is inactive");
  if (coupon.maxRedemptions !== undefined && coupon.redeemedCount >= coupon.maxRedemptions) {
    throw new Error("coupon redemption limit reached");
  }
  return { ...coupon, redeemedCount: coupon.redeemedCount + 1 };
}
