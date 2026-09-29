import { describe, expect, it } from "vitest";
import { capFor, duePeriod, grantExpiry, periodBounds, periodIndexAt, periodSecondsFor } from "../src/period.js";

const anchor = new Date("2030-01-31T00:00:00.000Z");
const P = periodSecondsFor("monthly");

describe("period math", () => {
  it("uses fixed 30-day months and 365-day years", () => {
    expect(periodSecondsFor("monthly")).toBe(2_592_000);
    expect(periodSecondsFor("yearly")).toBe(31_536_000);
  });

  it("computes half-open period bounds", () => {
    const p1 = periodBounds(anchor, P, 1);
    expect(p1.start.toISOString()).toBe("2030-03-02T00:00:00.000Z");
    expect(p1.end.toISOString()).toBe("2030-04-01T00:00:00.000Z");
    expect(periodIndexAt(anchor, P, p1.start)).toBe(1);
    expect(periodIndexAt(anchor, P, new Date(p1.end.getTime() - 1))).toBe(1);
    expect(periodIndexAt(anchor, P, p1.end)).toBe(2);
    expect(periodIndexAt(anchor, P, new Date(anchor.getTime() - 1))).toBe(-1);
  });

  it("only ever bills the current period, never back-bills", () => {
    expect(duePeriod(anchor, P, -1, anchor)).toBe(0);
    expect(duePeriod(anchor, P, 0, anchor)).toBeNull();
    const inP3 = periodBounds(anchor, P, 3).start;
    expect(duePeriod(anchor, P, 0, inP3)).toBe(3);
    expect(duePeriod(anchor, P, 3, inP3)).toBeNull();
    expect(duePeriod(anchor, P, -1, new Date(anchor.getTime() - 1000))).toBeNull();
  });

  it("sizes caps and expiries for N periods", () => {
    expect(capFor(9_990_000n, 12)).toBe(119_880_000n);
    expect(() => capFor(0n, 12)).toThrow(RangeError);
    expect(() => capFor(1n, 0)).toThrow(RangeError);
    const expiry = grantExpiry(anchor, P, 12);
    expect(expiry).toBe(Math.floor(anchor.getTime() / 1000) + 12 * P + 7 * 86_400);
  });

  it("rejects invalid period inputs", () => {
    expect(() => periodBounds(anchor, 0, 1)).toThrow(RangeError);
    expect(() => periodBounds(anchor, P, -1)).toThrow(RangeError);
    expect(() => periodIndexAt(anchor, 1.5, anchor)).toThrow(RangeError);
  });
});
