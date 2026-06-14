import { describe, expect, it } from "vitest";
import { addTreasuryApproval, transferMeetsPolicy } from "../src/index.js";

describe("treasury", () => {
  it("checks approval and amount policies", () => {
    const transfer = addTreasuryApproval({ amount: { amount: "50", currency: "USDC" }, approvals: [] }, "user_1");
    expect(transferMeetsPolicy(transfer, { requiredApprovals: 1, dailyLimit: { amount: "100", currency: "USDC" } })).toBe(true);
  });
});
