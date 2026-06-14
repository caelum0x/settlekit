import { describe, expect, it } from "vitest";
import { convertTrial, createTrial, trialIsActive } from "../src/index.js";

describe("trials", () => {
  it("creates active trials and converts them", () => {
    const trial = createTrial("cus_1", "prod_1", 14, new Date("2026-01-01T00:00:00.000Z"));
    expect(trial.endsAt).toBe("2026-01-15T00:00:00.000Z");
    expect(trialIsActive(convertTrial(trial))).toBe(false);
  });
});
