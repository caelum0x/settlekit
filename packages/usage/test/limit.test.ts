import { describe, expect, it } from "vitest";

import { checkLimit, createMeter, recordUsage, wouldExceedLimit } from "../src/index.js";

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

describe("checkLimit", () => {
  it("reports within-limit while value is below the cap", () => {
    const check = checkLimit(meterWith(40), 100);
    expect(check.withinLimit).toBe(true);
    expect(check.exceeded).toBe(false);
    expect(check.remaining).toBe(60);
  });

  it("treats reaching the limit exactly as within-limit", () => {
    const check = checkLimit(meterWith(100), 100);
    expect(check.withinLimit).toBe(true);
    expect(check.exceeded).toBe(false);
    expect(check.remaining).toBe(0);
  });

  it("reports exceeded once over the cap", () => {
    const check = checkLimit(meterWith(101), 100);
    expect(check.withinLimit).toBe(false);
    expect(check.exceeded).toBe(true);
    expect(check.remaining).toBe(0);
  });

  it("rejects a negative limit", () => {
    expect(() => checkLimit(meterWith(1), -1)).toThrow();
  });
});

describe("wouldExceedLimit", () => {
  it("predicts whether an increment crosses the cap", () => {
    const meter = meterWith(95);
    expect(wouldExceedLimit(meter, 100, 5)).toBe(false);
    expect(wouldExceedLimit(meter, 100, 6)).toBe(true);
  });
});
