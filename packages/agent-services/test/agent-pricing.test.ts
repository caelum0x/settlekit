import { describe, expect, it } from "vitest";
import { validateAgentPrice } from "../src/index.js";

describe("agent pricing", () => {
  it("normalizes USDC prices", () => {
    expect(validateAgentPrice("0.050000")).toBe("0.05");
  });
});
