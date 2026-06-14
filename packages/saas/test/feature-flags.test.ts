import { describe, expect, it } from "vitest";
import { featureEnabled, featureValue } from "../src/index.js";

describe("feature flags", () => {
  it("checks boolean and numeric features", () => {
    expect(featureEnabled({ ai_export: true }, "ai_export")).toBe(true);
    expect(featureValue({ max_projects: 10 }, "max_projects")).toBe(10);
  });
});
