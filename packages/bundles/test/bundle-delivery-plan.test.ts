import { describe, expect, it } from "vitest";
import { createBundle, createBundleDeliveryPlan } from "../src/index.js";

describe("createBundleDeliveryPlan", () => {
  it("combines delivery actions from bundle items", () => {
    const bundle = createBundle({
      merchantId: "mch_1",
      organizationId: "org_1",
      name: "Starter",
      description: "Repo + license",
      productIds: ["prod_1"],
      price: { amount: "149", currency: "USDC" },
      interval: "one_time",
    });
    const plan = createBundleDeliveryPlan(bundle, [{
      product: {
        id: "prod_1",
        merchantId: "mch_1",
        organizationId: "org_1",
        name: "Repo",
        description: "",
        type: "github_repo_access",
        status: "active",
        deliveryMode: "github_invite",
        metadata: {},
        createdAt: "",
        updatedAt: "",
      },
      deliveryActions: [{ type: "github_invite", repoId: "repo_1" }],
    }]);
    expect(plan.actions).toHaveLength(1);
    expect(plan.bundleId).toBe(bundle.id);
  });
});
