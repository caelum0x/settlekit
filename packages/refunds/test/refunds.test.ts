import { describe, expect, it } from "vitest";
import { createRefundRequest, refundRequiresAccessRevocation } from "../src/index.js";

describe("refunds", () => {
  it("rejects over-refunds and flags access revocation", () => {
    const payment = { id: "pay_1", organizationId: "org_1", checkoutSessionId: "cs_1", customerId: "cus_1", amount: { amount: "25", currency: "USDC" as const }, network: "arc" as const, confirmations: 1, status: "confirmed" as const, createdAt: "" };
    expect(() => createRefundRequest(payment, "26", "customer_request")).toThrow();
    expect(refundRequiresAccessRevocation(createRefundRequest(payment, "10", "customer_request"))).toBe(true);
  });
});
