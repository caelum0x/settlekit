import { describe, expect, it } from "vitest";
import { enableFeatureGate, featureGateAllows } from "../src/index.js";

describe("feature gates", () => {
  it("checks enabled gates and rollout", () => {
    const gate = enableFeatureGate({ key: "marketplace", enabled: false, rolloutPercent: 100 });
    expect(featureGateAllows(gate, "org_1")).toBe(true);
  });
});
