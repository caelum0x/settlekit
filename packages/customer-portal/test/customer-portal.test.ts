import { describe, expect, it } from "vitest";
import { activePortalEntitlements, buildCustomerPortalSnapshot } from "../src/index.js";

describe("customer portal", () => {
  it("filters active entitlements", () => {
    const snapshot = buildCustomerPortalSnapshot({ customerId: "cus_1", payments: [], subscriptions: [], licenseKeys: [], apiKeys: [], entitlements: [{ id: "ent_1", organizationId: "org_1", customerId: "cus_1", productId: "prod_1", grantedBy: { type: "payment", id: "pay_1" }, entitlementType: "file_access", status: "active", createdAt: "", updatedAt: "" }] });
    expect(activePortalEntitlements(snapshot)).toHaveLength(1);
  });
});
