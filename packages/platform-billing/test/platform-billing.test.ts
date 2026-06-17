import { describe, it, expect } from "vitest";
import { money, type Payment } from "@settlekit/common";
import {
  DEFAULT_FEE_SCHEDULE,
  applicationFee,
  computePlatformRevenue,
  normalizeSchedule,
  totalPlatformFees,
} from "../src/index.js";

function payment(amount: string, status: Payment["status"] = "confirmed"): Payment {
  return {
    id: `pay_${amount}_${status}`,
    organizationId: "org_1",
    checkoutSessionId: "cs_1",
    customerId: "cus_1",
    amount: money(amount),
    network: "arc",
    confirmations: 1,
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("platform-billing", () => {
  it("applies bps + fixed to a single payment", () => {
    // 2.5% of 100 = 2.50, + 0.30 fixed = 2.80
    const fee = applicationFee(money("100"), DEFAULT_FEE_SCHEDULE);
    expect(fee.amount).toBe("2.8");
  });

  it("uses floored bigint math with no floating-point drift", () => {
    // 2.5% of 33.333333 = 0.83333332..5 -> floors to 0.833333 (6dp USDC), + 0.30
    // fixed = 1.133333, computed exactly in base units (no float drift).
    const fee = applicationFee(money("33.333333"), { bps: 250, fixed: "0.30" });
    expect(fee.amount).toBe("1.133333");
  });

  it("never charges more than the payment itself (fee is capped)", () => {
    // 0.0025 + 0.30 = 0.3025 would exceed a 0.10 payment, so the fee caps at 0.10.
    const fee = applicationFee(money("0.10"), { bps: 250, fixed: "0.30" });
    expect(fee.amount).toBe("0.1");
  });

  it("supports a pure-percentage schedule (no fixed)", () => {
    const fee = applicationFee(money("50"), { bps: 1000, fixed: "0" });
    expect(fee.amount).toBe("5"); // 10% of 50
  });

  it("sums fees only over confirmed payments", () => {
    const payments = [
      payment("100"), // fee 2.80
      payment("200"), // fee 5.30
      payment("999", "pending"), // ignored
      payment("999", "refunded"), // ignored
    ];
    const total = totalPlatformFees(payments, DEFAULT_FEE_SCHEDULE);
    expect(total.amount).toBe("8.1");
  });

  it("computes full settlement economics (gross / fees / net)", () => {
    const revenue = computePlatformRevenue([payment("100"), payment("200")], DEFAULT_FEE_SCHEDULE);
    expect(revenue.grossVolume.amount).toBe("300");
    expect(revenue.platformFees.amount).toBe("8.1");
    expect(revenue.netToMerchant.amount).toBe("291.9");
    expect(revenue.paymentCount).toBe(2);
  });

  it("rejects an out-of-range or malformed schedule", () => {
    expect(() => normalizeSchedule({ bps: -1, fixed: "0" })).toThrow();
    expect(() => normalizeSchedule({ bps: 10_001, fixed: "0" })).toThrow();
    expect(() => normalizeSchedule({ bps: 2.5, fixed: "0" })).toThrow();
    expect(() => applicationFee(money("10"), { bps: 100, fixed: "-1" })).toThrow();
  });
});
