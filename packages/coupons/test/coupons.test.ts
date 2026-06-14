import { describe, expect, it } from "vitest";
import { applyCoupon, normalizeCouponCode, redeemCoupon } from "../src/index.js";

describe("coupons", () => {
  it("normalizes, applies, and redeems coupons", () => {
    const coupon = { code: normalizeCouponCode(" launch 25 "), active: true, redeemedCount: 0, maxRedemptions: 1, discount: { type: "percent" as const, percentOff: 25 } };
    expect(coupon.code).toBe("LAUNCH-25");
    expect(applyCoupon({ amount: "100", currency: "USDC" }, coupon).amount).toBe("75");
    expect(redeemCoupon(coupon).redeemedCount).toBe(1);
  });
});
