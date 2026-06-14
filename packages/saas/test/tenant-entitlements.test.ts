import { describe, expect, it } from "vitest";
import { entitlementsFromPlan } from "../src/index.js";

describe("tenant entitlements", () => {
  it("creates tenant entitlements from a plan", () => {
    const entitlement = entitlementsFromPlan("cus_1", {
      id: "plan_pro",
      productId: "prod_1",
      name: "Pro",
      features: { ai_export: true },
      seatsIncluded: 5,
      usageLimits: { api_calls: 1000 },
    });
    expect(entitlement.features.ai_export).toBe(true);
    expect(entitlement.seatsIncluded).toBe(5);
  });
});
