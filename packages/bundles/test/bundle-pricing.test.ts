import { money } from "@settlekit/common";
import { describe, expect, it } from "vitest";
import { createBundle, resolveBundlePrice, sumBundleItemPrices } from "../src/index.js";

describe("sumBundleItemPrices", () => {
  it("returns zero for an empty list", () => {
    expect(sumBundleItemPrices([])).toEqual(money("0"));
  });

  it("sums member prices", () => {
    const total = sumBundleItemPrices([money("100"), money("49.50"), money("0.50")]);
    expect(total).toEqual(money("150"));
  });

  it("throws on mixed currencies", () => {
    const usd = money("10");
    const other = { amount: "5", currency: "EUR" as unknown as "USDC" };
    expect(() => sumBundleItemPrices([usd, other])).toThrow(/mixed currencies/);
  });
});

describe("resolveBundlePrice", () => {
  it("uses the fixed override when provided", () => {
    const price = resolveBundlePrice({
      override: money("199"),
      memberPrices: [money("100"), money("100")],
    });
    expect(price).toEqual(money("199"));
  });

  it("sums member prices when no override is given", () => {
    const price = resolveBundlePrice({
      memberPrices: [money("100"), money("100")],
    });
    expect(price).toEqual(money("200"));
  });
});

describe("createBundle pricing", () => {
  it("derives a summed price from member prices", () => {
    const bundle = createBundle({
      merchantId: "mch_1",
      organizationId: "org_1",
      name: "Sum",
      productIds: ["p1", "p2"],
      memberPrices: [money("120"), money("80")],
    });
    expect(bundle.price).toEqual(money("200"));
  });

  it("honours a fixed override price", () => {
    const bundle = createBundle({
      merchantId: "mch_1",
      organizationId: "org_1",
      name: "Fixed",
      productIds: ["p1", "p2"],
      price: money("149"),
      memberPrices: [money("120"), money("80")],
    });
    expect(bundle.price).toEqual(money("149"));
  });
});
