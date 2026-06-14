import { describe, expect, it } from "vitest";
import { createPayoutBatch, markPayoutBatchSubmitted } from "../src/index.js";

describe("payouts", () => {
  it("creates payout batches with totals", () => {
    const batch = createPayoutBatch("arc", [{ merchantId: "mch_1", walletAddress: "0xabc", amount: { amount: "2", currency: "USDC" } }]);
    expect(batch.total.amount).toBe("2");
    expect(markPayoutBatchSubmitted(batch).status).toBe("submitted");
  });
});
