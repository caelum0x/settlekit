import { describe, expect, it } from "vitest";
import { conversionRate, totalConfirmedRevenue } from "../src/index.js";

describe("analytics", () => {
  it("calculates revenue and conversion", () => {
    expect(totalConfirmedRevenue([{ id: "pay_1", organizationId: "org_1", checkoutSessionId: "cs_1", customerId: "cus_1", amount: { amount: "1.5", currency: "USDC" }, network: "arc", confirmations: 1, status: "confirmed", createdAt: "" }]).amount).toBe("1.5");
    expect(conversionRate(25, 100)).toBe(0.25);
  });
});
