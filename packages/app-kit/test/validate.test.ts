import { describe, expect, it } from "vitest";
import { validateBps } from "../src/index.js";

describe("validateBps", () => {
  it("accepts the inclusive 0..10000 integer range", () => {
    for (const value of [0, 1, 50, 5000, 10000]) {
      expect(validateBps(value, "bps")).toBeNull();
    }
  });

  it("rejects values outside the range", () => {
    for (const value of [-1, 10001, 99999]) {
      const error = validateBps(value, "bps");
      expect(error).not.toBeNull();
      expect(error?.code).toBe("validation_error");
    }
  });

  it("rejects non-integers including NaN and Infinity", () => {
    for (const value of [1.5, 12.3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const error = validateBps(value, "bps");
      expect(error).not.toBeNull();
      expect(error?.code).toBe("validation_error");
    }
  });

  it("includes the field name in the error details", () => {
    const error = validateBps(-1, "slippageBps");
    expect(error?.details).toMatchObject({ field: "slippageBps", value: -1 });
  });
});
