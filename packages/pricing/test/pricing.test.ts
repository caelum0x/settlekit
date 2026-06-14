import { describe, expect, it } from "vitest";
import { canCreateProduct, feeAmount } from "../src/index.js";

describe("pricing", () => {
  it("checks hosted plan limits and fees", () => {
    expect(canCreateProduct("free", 3)).toBe(false);
    expect(canCreateProduct("business", 10_000)).toBe(true);
    expect(feeAmount(1_000_000n, 100)).toBe(10_000n);
  });
});
