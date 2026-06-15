import { describe, expect, it } from "vitest";
import { createRevenueReport, sumRevenueReports } from "../src/index.js";

describe("reporting", () => {
  it("creates and sums revenue reports", () => {
    const report = createRevenueReport({ periodStart: "2026-01-01T00:00:00.000Z", periodEnd: "2026-02-01T00:00:00.000Z", grossRevenue: { amount: "25", currency: "USDC" }, transactionCount: 1, refundCount: 0 });
    expect(sumRevenueReports([report]).amount).toBe("25");
  });
});
