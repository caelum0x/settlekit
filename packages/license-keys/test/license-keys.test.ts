import { describe, expect, it } from "vitest";
import { activateMachine, issueLicenseKey, verifyLicenseKey } from "../src/index.js";

describe("license keys", () => {
  it("issues and activates license keys", () => {
    const key = issueLicenseKey({
      organizationId: "org_1",
      customerId: "cus_1",
      productId: "prod_1",
      entitlementId: "ent_1",
      policy: { id: "policy_1", machineLimit: 1 },
    });
    expect(verifyLicenseKey(key).active).toBe(true);
    expect(activateMachine(key, "machine_1").activatedMachineIds).toEqual(["machine_1"]);
  });
});
