import { describe, expect, it } from "vitest";
import { applyBillingCredit, grantBillingCredit, totalBillingCredits } from "../src/index.js";

describe("billing credits", () => {
  it("grants and applies credits", () => {
    const credit = grantBillingCredit({ customerId: "cus_1", amount: { amount: "10", currency: "USDC" }, reason: "promotion" });
    expect(totalBillingCredits([credit]).amount).toBe("10");
    expect(applyBillingCredit({ amount: "8", currency: "USDC" }, credit.amount).amount).toBe("0");
  });
});
