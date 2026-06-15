import { describe, expect, it } from "vitest";
import { applyCoupon, normalizeCouponCode, redeemCoupon, type Coupon } from "../src/index.js";

describe("coupons", () => {
  it("normalizes, applies, and redeems coupons", () => {
    const coupon: Coupon = {
      code: normalizeCouponCode(" launch 25 "),
      currency: "USDC",
      status: "active",
      redeemedCount: 0,
      maxRedemptions: 1,
      discount: { type: "percent", percentOff: 25 },
    };
    expect(coupon.code).toBe("LAUNCH-25");

    const result = applyCoupon({ amount: "100", currency: "USDC" }, coupon);
    expect(result.ok).toBe(true);
    expect(result.discount.amount).toBe("25");
    expect(result.total.amount).toBe("75");

    expect(redeemCoupon(coupon).redeemedCount).toBe(1);
  });
});
