import type { Payment, Product } from "@settlekit/common";
import { money } from "@settlekit/common";
import { describe, expect, it } from "vitest";
import { buildBundleEntitlements, createBundle, type BundleMember } from "../src/index.js";

function product(id: string): Product {
  return {
    id,
    merchantId: "mch_1",
    organizationId: "org_1",
    name: `Product ${id}`,
    description: "",
    type: "github_repo_access",
    status: "active",
    deliveryMode: "github_invite",
    metadata: {},
    createdAt: "",
    updatedAt: "",
  };
}

function payment(): Payment {
  return {
    id: "pay_123",
    organizationId: "org_1",
    checkoutSessionId: "cs_1",
    customerId: "cus_1",
    amount: money("200"),
    network: "arc",
    confirmations: 3,
    status: "confirmed",
    createdAt: "2026-06-15T00:00:00.000Z",
  };
}

describe("buildBundleEntitlements", () => {
  const bundle = createBundle({
    merchantId: "mch_1",
    organizationId: "org_1",
    name: "Bundle",
    productIds: ["prod_repo", "prod_saas"],
    price: money("200"),
  });

  const members: BundleMember[] = [
    {
      product: product("prod_saas"),
      deliveryActions: [],
      entitlementType: "saas_feature",
      features: { seats: 5, pro: true },
    },
    {
      product: product("prod_repo"),
      deliveryActions: [],
      entitlementType: "github_repo_access",
      resourceId: "repo_42",
    },
  ];

  it("creates one entitlement per member", () => {
    const ents = buildBundleEntitlements(bundle, payment(), members);
    expect(ents).toHaveLength(2);
  });

  it("orders entitlements by bundle.productIds", () => {
    const ents = buildBundleEntitlements(bundle, payment(), members);
    expect(ents.map((e) => e.productId)).toEqual(["prod_repo", "prod_saas"]);
  });

  it("links every entitlement back to the payment via grantedBy bundle", () => {
    const ents = buildBundleEntitlements(bundle, payment(), members);
    for (const ent of ents) {
      expect(ent.grantedBy).toEqual({ type: "bundle", id: "pay_123" });
      expect(ent.customerId).toBe("cus_1");
      expect(ent.organizationId).toBe("org_1");
      expect(ent.status).toBe("active");
    }
  });

  it("copies type-specific fields (features, resourceId)", () => {
    const ents = buildBundleEntitlements(bundle, payment(), members);
    const repo = ents.find((e) => e.productId === "prod_repo");
    const saas = ents.find((e) => e.productId === "prod_saas");
    expect(repo?.resourceId).toBe("repo_42");
    expect(saas?.features).toEqual({ seats: 5, pro: true });
  });

  it("maps creditsGranted to creditsRemaining", () => {
    const creditBundle = createBundle({
      merchantId: "mch_1",
      organizationId: "org_1",
      name: "Credits",
      productIds: ["prod_api"],
      price: money("10"),
    });
    const ents = buildBundleEntitlements(creditBundle, payment(), [
      {
        product: product("prod_api"),
        deliveryActions: [],
        entitlementType: "api_credits",
        creditsGranted: 1000,
      },
    ]);
    expect(ents[0]?.creditsRemaining).toBe(1000);
  });
});
