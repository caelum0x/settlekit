import type { DeliveryAction, Product } from "@settlekit/common";
import { describe, expect, it } from "vitest";
import { buildBundleDeliveryPlan, createBundle, createBundleDeliveryPlan } from "../src/index.js";

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

describe("buildBundleDeliveryPlan", () => {
  it("combines delivery actions from bundle members", () => {
    const bundle = createBundle({
      merchantId: "mch_1",
      organizationId: "org_1",
      name: "Starter",
      description: "Repo + license",
      productIds: ["prod_1"],
      price: { amount: "149", currency: "USDC" },
      interval: "one_time",
    });
    const plan = buildBundleDeliveryPlan(bundle, [
      {
        product: product("prod_1"),
        deliveryActions: [{ type: "github_invite", repoId: "repo_1" }],
      },
    ]);
    expect(plan.actions).toHaveLength(1);
    expect(plan.bundleId).toBe(bundle.id);
    expect(plan.organizationId).toBe("org_1");
  });

  it("concatenates actions across members in bundle.productIds order", () => {
    const bundle = createBundle({
      merchantId: "mch_1",
      organizationId: "org_1",
      name: "Pro",
      productIds: ["prod_a", "prod_b"],
      price: { amount: "300", currency: "USDC" },
    });
    const repoAction: DeliveryAction = { type: "github_invite", repoId: "repo_a" };
    const fileAction: DeliveryAction = { type: "file_access_grant", fileId: "file_b" };
    const emailAction: DeliveryAction = { type: "email_send", template: "welcome" };

    const plan = buildBundleDeliveryPlan(bundle, [
      { product: product("prod_b"), deliveryActions: [fileAction] },
      { product: product("prod_a"), deliveryActions: [repoAction, emailAction] },
    ]);

    // Ordered by productIds (prod_a then prod_b), preserving in-member order.
    expect(plan.actions).toEqual([repoAction, emailAction, fileAction]);
  });

  it("de-duplicates identical actions across members", () => {
    const bundle = createBundle({
      merchantId: "mch_1",
      organizationId: "org_1",
      name: "Overlap",
      productIds: ["prod_a", "prod_b"],
      price: { amount: "100", currency: "USDC" },
    });
    const shared: DeliveryAction = { type: "email_send", template: "welcome" };

    const plan = buildBundleDeliveryPlan(bundle, [
      { product: product("prod_a"), deliveryActions: [shared] },
      { product: product("prod_b"), deliveryActions: [shared] },
    ]);

    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toEqual(shared);
  });

  it("ignores members whose product is not in the bundle", () => {
    const bundle = createBundle({
      merchantId: "mch_1",
      organizationId: "org_1",
      name: "Scoped",
      productIds: ["prod_a"],
      price: { amount: "50", currency: "USDC" },
    });

    const plan = buildBundleDeliveryPlan(bundle, [
      { product: product("prod_a"), deliveryActions: [{ type: "email_send", template: "a" }] },
      { product: product("prod_stray"), deliveryActions: [{ type: "email_send", template: "b" }] },
    ]);

    expect(plan.actions).toEqual([{ type: "email_send", template: "a" }]);
  });

  it("exposes createBundleDeliveryPlan as an alias", () => {
    expect(createBundleDeliveryPlan).toBe(buildBundleDeliveryPlan);
  });
});
