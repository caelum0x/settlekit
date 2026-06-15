import { describe, expect, it } from "vitest";
import { completeOnboardingStep, nextOnboardingStep } from "../src/index.js";

describe("onboarding", () => {
  it("tracks completed steps and next step", () => {
    const progress = completeOnboardingStep({ organizationId: "org_1", completedSteps: [] }, "create_organization");
    expect(nextOnboardingStep(progress)).toBe("connect_wallet");
  });
});
