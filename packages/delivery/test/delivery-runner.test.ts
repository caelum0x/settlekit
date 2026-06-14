import { describe, expect, it } from "vitest";
import { createDeliveryPlan, runDeliveryPlan } from "../src/index.js";

describe("runDeliveryPlan", () => {
  it("runs registered delivery actions in order", async () => {
    const plan = createDeliveryPlan({
      organizationId: "org_1",
      productId: "prod_1",
      actions: [{ type: "license_key_create", policyId: "policy_1" }],
    });
    const run = await runDeliveryPlan({
      plan,
      context: { organizationId: "org_1", paymentId: "pay_1", customerId: "cus_1" },
      handlers: {
        license_key_create: async () => ({ key: "lic_1" }),
      },
    });
    expect(run.status).toBe("succeeded");
    expect(run.actionRuns[0]?.output?.key).toBe("lic_1");
  });
});
