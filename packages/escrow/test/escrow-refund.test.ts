import { describe, expect, it } from "vitest";
import { createEscrowTask, refundEscrow } from "../src/index.js";

describe("escrow refund", () => {
  it("refunds a created task", () => {
    expect(refundEscrow(createEscrowTask({ organizationId: "org_1", buyerCustomerId: "cus_1", title: "Task", description: "", amount: "10", currency: "USDC" })).status).toBe("refunded");
  });
});
