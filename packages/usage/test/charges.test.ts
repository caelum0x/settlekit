import { money } from "@settlekit/common";
import { describe, expect, it } from "vitest";

import { computeMeteredCharge, computeUsageCharge, createMeter, recordUsage } from "../src/index.js";

const start = new Date("2026-01-01T00:00:00.000Z");
const base = {
  organizationId: "org_1",
  customerId: "cus_1",
  productId: "prod_1",
  metric: "api_calls",
} as const;

function meterWith(value: number) {
  return recordUsage(createMeter({ ...base, periodStart: start, period: "monthly" }), "api_calls", value);
}

describe("computeUsageCharge", () => {
  it("multiplies unit price by recorded units", () => {
    const charge = computeUsageCharge(meterWith(1000), money("0.001"));
    expect(charge).toEqual(money("1.000000"));
  });

  it("returns zero for a meter with no usage", () => {
    const charge = computeUsageCharge(meterWith(0), money("0.05"));
    expect(charge.amount).toBe("0");
    expect(charge.currency).toBe("USDC");
  });

  it("handles a single unit price exactly", () => {
    const charge = computeUsageCharge(meterWith(3), money("2.50"));
    expect(charge).toEqual(money("7.500000"));
  });
});

describe("computeMeteredCharge", () => {
  it("only bills units in excess of the included allowance", () => {
    const charge = computeMeteredCharge(meterWith(1200), money("0.01"), 1000);
    expect(charge).toEqual(money("2.000000"));
  });

  it("bills nothing when usage is within the allowance", () => {
    const charge = computeMeteredCharge(meterWith(500), money("0.01"), 1000);
    expect(charge.amount).toBe("0");
  });

  it("rejects a negative allowance", () => {
    expect(() => computeMeteredCharge(meterWith(10), money("0.01"), -5)).toThrow();
  });
});
