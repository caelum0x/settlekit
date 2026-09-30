import { describe, expect, it } from "vitest";
import { money, type CheckoutSession } from "@settlekit/common";
import { InMemoryCouponStore, type Coupon } from "@settlekit/coupons";
import { quoteSessionCoupon, redeemSessionCoupon, withSessionDiscount } from "../src/session-coupons.js";

function coupon(over: Partial<Coupon>): Coupon {
  return {
    code: "LAUNCH20",
    organizationId: "org_1",
    discount: { type: "percent", percentOff: 20 },
    currency: "USDC",
    status: "active",
    redeemedCount: 0,
    ...over,
  };
}

async function store(...coupons: Coupon[]): Promise<InMemoryCouponStore> {
  const s = new InMemoryCouponStore();
  for (const c of coupons) await s.save(c);
  return s;
}

const lines = [
  { productId: "prod_a", amount: money("100") },
  { productId: "prod_b", amount: money("50") },
];

describe("session coupons", () => {
  it("applies a percent code to the whole order", async () => {
    const q = await quoteSessionCoupon({ store: await store(coupon({})), code: " launch20 ", organizationId: "org_1", lines });
    expect(q).toEqual({
      ok: true,
      total: money("120"),
      discount: { couponCode: "LAUNCH20", subtotal: money("150"), amountOff: money("30") },
    });
  });

  it("scopes a product-limited code to its products", async () => {
    const s = await store(coupon({ code: "BONLY", discount: { type: "amount", amountOff: money("10") }, appliesToProductIds: ["prod_b"] }));
    const q = await quoteSessionCoupon({ store: s, code: "bonly", organizationId: "org_1", lines });
    expect(q.ok && q.total.amount).toBe("140");
    const none = await quoteSessionCoupon({ store: s, code: "BONLY", organizationId: "org_1", lines: [lines[0]!] });
    expect(none).toEqual({ ok: false, reason: "This promo code does not apply to these items." });
  });

  it("hides other sellers' codes and rejects unusable ones", async () => {
    const s = await store(
      coupon({ code: "OTHER", organizationId: "org_2" }),
      coupon({ code: "TRIAL", discount: { type: "free-trial-days", days: 7 } }),
      coupon({ code: "FREE", discount: { type: "percent", percentOff: 100 } }),
      coupon({ code: "OLD", expiresAt: "2020-01-01T00:00:00.000Z" }),
      coupon({ code: "USED", maxRedemptions: 1, redeemedCount: 1 }),
    );
    const reason = async (code: string) => {
      const q = await quoteSessionCoupon({ store: s, code, organizationId: "org_1", lines });
      return q.ok ? "ok" : q.reason;
    };
    expect(await reason("OTHER")).toMatch(/not valid/);
    expect(await reason("NOPE")).toMatch(/not valid/);
    expect(await reason("TRIAL")).toMatch(/free trial/);
    expect(await reason("FREE")).toMatch(/whole price/);
    expect(await reason("OLD")).toMatch(/expired/);
    expect(await reason("USED")).toMatch(/fully used/);
    expect(await reason("")).toMatch(/valid promo/);
  });

  it("enforces the per-customer limit and redeems once after confirmation", async () => {
    const s = await store(coupon({ perCustomerLimit: 1 }));
    const q = await quoteSessionCoupon({ store: s, code: "LAUNCH20", organizationId: "org_1", lines, customerId: "cus_1" });
    if (!q.ok) throw new Error(q.reason);
    const session = withSessionDiscount({ id: "cs_1", amount: money("150") } as CheckoutSession, q);
    expect(session.amount.amount).toBe("120");

    const redeemed = await redeemSessionCoupon(s, session, "cus_1", new Date("2026-09-30T00:00:00Z"));
    expect(redeemed?.discount?.redeemedAt).toBe("2026-09-30T00:00:00.000Z");
    expect((await s.findByCode("LAUNCH20"))?.redeemedCount).toBe(1);
    // Idempotent: already redeemed.
    expect(await redeemSessionCoupon(s, redeemed!, "cus_1")).toBeNull();
    expect((await s.findByCode("LAUNCH20"))?.redeemedCount).toBe(1);
    // Same customer cannot use it again.
    const again = await quoteSessionCoupon({ store: s, code: "LAUNCH20", organizationId: "org_1", lines, customerId: "cus_1" });
    expect(again.ok).toBe(false);
  });
});

describe("session tax", () => {
  it("adds tax on the net price, re-rates by country and survives a promo without compounding", async () => {
    const { withSessionTax } = await import("../src/session-tax.js");
    const settings = { enabled: true, label: "VAT", sellerCountry: "DE", defaultRateBps: 0, rates: { DE: 1900, FR: 2000 }, reverseCharge: true };
    const base = { id: "cs_t", organizationId: "org_1", amount: money("100"), lineItems: [] } as unknown as CheckoutSession;

    const de = withSessionTax(base, settings);
    expect(de.amount.amount).toBe("119");
    expect(de.tax).toMatchObject({ net: { amount: "100" }, amount: { amount: "19" }, rateBps: 1900, jurisdiction: "DE", label: "VAT" });

    const fr = withSessionTax(de, settings, { country: "FR" });
    expect(fr.amount.amount).toBe("120");
    const b2b = withSessionTax(fr, settings, { country: "FR", vatId: "FR12345678901" });
    expect(b2b.amount.amount).toBe("100");
    expect(b2b.tax?.reverseCharge).toBe(true);

    // Promo on a taxed session: tax recomputed on the discounted net.
    const s = await store(coupon({}));
    const q = await quoteSessionCoupon({ store: s, code: "LAUNCH20", organizationId: "org_1", lines: [{ amount: money("100") }] });
    if (!q.ok) throw new Error(q.reason);
    const discounted = withSessionDiscount(fr, q);
    expect(discounted.tax?.net.amount).toBe("80");
    expect(discounted.amount.amount).toBe("96");

    // Tax off: the session goes back to the net price.
    const off = withSessionTax(discounted, { ...settings, enabled: false });
    expect(off.amount.amount).toBe("80");
    expect(off.tax).toBeUndefined();
  });
});
