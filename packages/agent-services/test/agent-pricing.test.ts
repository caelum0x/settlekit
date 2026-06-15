import { describe, expect, it } from "vitest";
import { validateAgentPrice, agentRequestPrice, agentUsageCost } from "../src/index.js";

describe("agent pricing", () => {
  it("normalizes USDC prices", () => {
    expect(validateAgentPrice("0.050000")).toBe("0.05");
  });

  it("exposes the per-request price as Money", () => {
    expect(agentRequestPrice("0.05")).toEqual({ amount: "0.05", currency: "USDC" });
  });

  it("computes usage cost across multiple requests without float drift", () => {
    expect(agentUsageCost("0.05", 3)).toEqual({ amount: "0.15", currency: "USDC" });
    expect(agentUsageCost("0.000001", 1000000)).toEqual({ amount: "1", currency: "USDC" });
  });

  it("rejects negative request counts", () => {
    expect(() => agentUsageCost("0.05", -1)).toThrow(RangeError);
  });
});
