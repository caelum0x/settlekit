import { describe, expect, it } from "vitest";
import { createDunningSchedule, shouldRevokeAfterDunning } from "../src/index.js";

describe("dunning", () => {
  it("creates retry schedules and revocation signal", () => {
    const sub = { id: "sub_1", organizationId: "org_1", customerId: "cus_1", productId: "prod_1", priceId: "price_1", status: "past_due" as const, currentPeriodStart: "", currentPeriodEnd: "", cancelAtPeriodEnd: false, createdAt: "" };
    const attempts = createDunningSchedule(sub, [1, 3], new Date("2026-01-01T00:00:00.000Z"));
    expect(attempts[1]?.channel).toBe("webhook");
    expect(shouldRevokeAfterDunning(sub, attempts, new Date("2026-01-04T00:00:00.000Z"))).toBe(true);
  });
});
