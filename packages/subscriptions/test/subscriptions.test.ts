import { describe, expect, it } from "vitest";
import { cancelAtPeriodEnd, createSubscription, markPastDue } from "../src/index.js";

describe("subscriptions", () => {
  it("creates and updates subscription lifecycle state", () => {
    const sub = createSubscription({ id: "sub_1", organizationId: "org_1", customerId: "cus_1", productId: "prod_1", priceId: "price_1", interval: "monthly" }, new Date("2026-01-01T00:00:00.000Z"));
    expect(sub.currentPeriodEnd).toBe("2026-02-01T00:00:00.000Z");
    expect(markPastDue(cancelAtPeriodEnd(sub), 3).status).toBe("past_due");
  });
});
