import { describe, expect, it } from "vitest";
import type { Entitlement } from "@settlekit/common";
import { consumeCredits, mergeFeatureEntitlements, verifyEntitlement } from "../src/index.js";

const base: Entitlement = {
  id: "ent_1",
  organizationId: "org_1",
  customerId: "cus_1",
  productId: "prod_1",
  grantedBy: { type: "payment", id: "pay_1" },
  entitlementType: "saas_feature",
  status: "active",
  features: { ai_export: true, max_projects: 10 },
  creditsRemaining: 20,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("entitlements", () => {
  it("allows active feature access", () => {
    expect(verifyEntitlement({ entitlements: [base], customerId: "cus_1", feature: "ai_export" })).toMatchObject({
      allowed: true,
      value: true,
    });
  });

  it("denies expired entitlements", () => {
    const expired = { ...base, expiresAt: "2025-01-01T00:00:00.000Z" };
    expect(verifyEntitlement({ entitlements: [expired], customerId: "cus_1", now: new Date("2026-01-01") })).toMatchObject({
      allowed: false,
      reason: "expired",
    });
  });

  it("consumes credits immutably", () => {
    expect(consumeCredits(base, 5).creditsRemaining).toBe(15);
    expect(base.creditsRemaining).toBe(20);
  });

  it("merges features from active entitlements", () => {
    expect(mergeFeatureEntitlements([base, { ...base, id: "ent_2", features: { seats: 5 } }])).toEqual({
      ai_export: true,
      max_projects: 10,
      seats: 5,
    });
  });
});
