import { describe, expect, it } from "vitest";
import { formatUsdc, translate } from "../src/index.js";

describe("localization", () => {
  it("translates keys and formats USDC", () => {
    expect(translate({ checkout: { en: "Checkout", tr: "Odeme" } }, "checkout", "tr")).toBe("Odeme");
    expect(formatUsdc("25.5", "en")).toBe("25.5 USDC");
  });
});
