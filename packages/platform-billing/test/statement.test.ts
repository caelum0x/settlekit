import { describe, expect, it } from "vitest";
import { money, type Payment } from "@settlekit/common";
import {
  billingStanding,
  buildFeeStatement,
  isBillingPeriod,
  meetsMinimum,
  periodBounds,
  previousPeriod,
  statementDescription,
} from "../src/index.js";

function payment(id: string, amount: string, confirmedAt: string, status: Payment["status"] = "confirmed"): Payment {
  return {
    id,
    organizationId: "org_m",
    checkoutSessionId: `cs_${id}`,
    customerId: "cus_1",
    amount: money(amount),
    network: "base",
    confirmations: 3,
    status,
    createdAt: confirmedAt,
    confirmedAt,
  };
}

describe("billing periods", () => {
  it("parses months and finds the previous one across a year boundary", () => {
    expect(isBillingPeriod("2026-09")).toBe(true);
    expect(isBillingPeriod("2026-13")).toBe(false);
    const { start, end } = periodBounds("2026-12");
    expect(start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(previousPeriod(new Date("2027-01-15T00:00:00Z"))).toBe("2026-12");
    expect(() => periodBounds("2026-9")).toThrow(/YYYY-MM/);
  });
});

describe("fee statements", () => {
  const payments = [
    payment("a", "100", "2026-09-01T00:00:00.000Z"),
    payment("b", "250.50", "2026-09-30T23:59:59.000Z"),
    payment("c", "999", "2026-10-01T00:00:00.000Z"),
    payment("d", "80", "2026-09-10T00:00:00.000Z", "pending"),
    payment("e", "40", "2026-08-31T23:59:59.000Z"),
  ];

  it("bills confirmed payments inside the coverage window only", () => {
    const { start, end } = periodBounds("2026-09");
    const s = buildFeeStatement({ payments, schedule: { bps: 100, fixed: "0" }, coverageStart: start, coverageEnd: end });
    expect(s.paymentIds).toEqual(["a", "b"]);
    expect(s.grossVolume.amount).toBe("350.5");
    expect(s.fees.amount).toBe("3.505");
    expect(statementDescription(s, "2026-09")).toBe("SettleKit fees 2026-09: 2 payments, 350.5 USDC volume at 1%");
  });

  it("carries unbilled earlier payments forward when coverage starts earlier", () => {
    const s = buildFeeStatement({
      payments,
      schedule: { bps: 50, fixed: "0.10" },
      coverageStart: new Date("2026-08-01T00:00:00Z"),
      coverageEnd: periodBounds("2026-09").end,
    });
    expect(s.paymentIds).toEqual(["a", "b", "e"]);
    // 0.5% of 100 + 250.5 + 40 = 1.9525, plus 3 x 0.10
    expect(s.fees.amount).toBe("2.2525");
    expect(statementDescription(s, "2026-09")).toContain("at 0.5% + 0.10 per payment");
  });

  it("applies the billing minimum", () => {
    const { start, end } = periodBounds("2026-09");
    const s = buildFeeStatement({ payments, schedule: { bps: 100, fixed: "0" }, coverageStart: start, coverageEnd: end });
    expect(meetsMinimum(s, "1")).toBe(true);
    expect(meetsMinimum(s, "5")).toBe(false);
    const empty = buildFeeStatement({ payments: [], schedule: { bps: 100, fixed: "0" }, coverageStart: start, coverageEnd: end });
    expect(meetsMinimum(empty, "0")).toBe(false);
    expect(() => buildFeeStatement({ payments, schedule: { bps: 100, fixed: "0" }, coverageStart: end, coverageEnd: start })).toThrow();
  });
});

describe("billing standing", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  it("escalates from due to past due to restricted after the grace window", () => {
    expect(billingStanding([], now, 7)).toBe("good");
    expect(billingStanding([{ status: "paid", dueAt: "2026-10-01T00:00:00Z" }], now, 7)).toBe("good");
    expect(billingStanding([{ status: "open", dueAt: "2026-10-25T00:00:00Z" }], now, 7)).toBe("due");
    expect(billingStanding([{ status: "open", dueAt: "2026-10-15T00:00:00Z" }], now, 7)).toBe("past_due");
    expect(billingStanding([{ status: "open", dueAt: "2026-10-01T00:00:00Z" }], now, 7)).toBe("restricted");
    expect(
      billingStanding(
        [
          { status: "open", dueAt: "2026-10-25T00:00:00Z" },
          { status: "open", dueAt: "2026-10-01T00:00:00Z" },
        ],
        now,
        30,
      ),
    ).toBe("past_due");
  });
});
