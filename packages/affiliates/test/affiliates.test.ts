import { describe, expect, it } from "vitest";
import { calculateAffiliateCommission, createAffiliateAttribution } from "../src/index.js";

describe("affiliates", () => {
  it("calculates commission and attribution", () => {
    expect(calculateAffiliateCommission({ amount: "100", currency: "USDC" }, { id: "afp_1", merchantId: "mch_1", commissionBps: 1000, cookieDays: 30, active: true }).amount).toBe("10");
    expect(createAffiliateAttribution("afp_1", "aff_1", "cus_1").affiliateId).toBe("aff_1");
  });
});
