import { describe, expect, it } from "vitest";
import { calculateTax, taxExemptCalculation } from "../src/index.js";

describe("tax", () => {
  it("calculates exclusive and exempt tax", () => {
    expect(calculateTax({ amount: "100", currency: "USDC" }, { jurisdiction: "US", rateBps: 825, inclusive: false }).total.amount).toBe("108.25");
    expect(taxExemptCalculation({ amount: "100", currency: "USDC" }).tax.amount).toBe("0");
  });
});
