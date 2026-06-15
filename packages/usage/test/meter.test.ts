import { describe, expect, it } from "vitest";

import {
  aggregateForPeriod,
  createMeter,
  recordUsage,
  resetForNewPeriod,
} from "../src/index.js";

const base = {
  organizationId: "org_1",
  customerId: "cus_1",
  productId: "prod_1",
  metric: "api_calls",
} as const;

describe("createMeter", () => {
  it("opens an empty meter with a derived monthly period window", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const meter = createMeter({ ...base, periodStart: start, period: "monthly" });

    expect(meter.value).toBe(0);
    expect(meter.metric).toBe("api_calls");
    expect(meter.periodStart).toBe("2026-01-01T00:00:00.000Z");
    expect(meter.periodEnd).toBe("2026-02-01T00:00:00.000Z");
    expect(meter.id.startsWith("um_") || meter.id.length > 0).toBe(true);
  });

  it("rejects empty identity fields", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    expect(() => createMeter({ ...base, metric: "  ", periodStart: start, period: "monthly" })).toThrow();
  });
});

describe("recordUsage", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");

  it("accumulates quantity into a new meter without mutating the original", () => {
    const meter = createMeter({ ...base, periodStart: start, period: "monthly" });
    const after1 = recordUsage(meter, "api_calls", 5);
    const after2 = recordUsage(after1, "api_calls", 3);

    expect(meter.value).toBe(0);
    expect(after1.value).toBe(5);
    expect(after2.value).toBe(8);
    expect(after2).not.toBe(after1);
  });

  it("supports fractional quantities", () => {
    const meter = createMeter({ ...base, periodStart: start, period: "monthly" });
    const after = recordUsage(meter, "api_calls", 2.5);
    expect(after.value).toBe(2.5);
  });

  it("throws on a metric mismatch", () => {
    const meter = createMeter({ ...base, periodStart: start, period: "monthly" });
    expect(() => recordUsage(meter, "bandwidth", 1)).toThrow();
  });

  it("throws on a negative or non-finite quantity", () => {
    const meter = createMeter({ ...base, periodStart: start, period: "monthly" });
    expect(() => recordUsage(meter, "api_calls", -1)).toThrow();
    expect(() => recordUsage(meter, "api_calls", Number.NaN)).toThrow();
  });
});

describe("aggregateForPeriod", () => {
  it("sums only meters matching metric and period window", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const m1 = recordUsage(createMeter({ ...base, periodStart: start, period: "monthly" }), "api_calls", 4);
    const m2 = recordUsage(createMeter({ ...base, periodStart: start, period: "monthly" }), "api_calls", 6);
    const otherMetric = recordUsage(
      createMeter({ ...base, metric: "bandwidth", periodStart: start, period: "monthly" }),
      "bandwidth",
      100,
    );
    const otherPeriod = recordUsage(
      createMeter({ ...base, periodStart: new Date("2026-02-01T00:00:00.000Z"), period: "monthly" }),
      "api_calls",
      999,
    );

    const total = aggregateForPeriod(
      [m1, m2, otherMetric, otherPeriod],
      "api_calls",
      "2026-01-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
    );
    expect(total).toBe(10);
  });
});

describe("resetForNewPeriod", () => {
  it("returns a fresh zeroed meter advanced to a new period", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const used = recordUsage(createMeter({ ...base, periodStart: start, period: "monthly" }), "api_calls", 42);

    const next = resetForNewPeriod(used, new Date("2026-02-01T00:00:00.000Z"), "monthly");
    expect(next.value).toBe(0);
    expect(next.periodStart).toBe("2026-02-01T00:00:00.000Z");
    expect(next.periodEnd).toBe("2026-03-01T00:00:00.000Z");
    expect(next.id).not.toBe(used.id);
    expect(next.metric).toBe(used.metric);
  });
});
