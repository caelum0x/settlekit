import { describe, expect, it } from "vitest";
import { unwrap } from "@settlekit/common";
import { money } from "@settlekit/common";
import {
  createPlan,
  featureEnabled,
  featureLimit,
  listPlans,
  UNLIMITED,
  type SaasPlan,
} from "../src/index.js";

function pro(): SaasPlan {
  return unwrap(
    createPlan({
      productId: "prod_1",
      name: "Pro",
      interval: "monthly",
      price: money("25"),
      features: { sso: true, beta: false, projects: 10, api_calls: UNLIMITED },
      seats: 5,
      now: new Date("2026-01-01T00:00:00.000Z"),
    }),
  );
}

describe("createPlan + listPlans", () => {
  it("rejects empty names and negative seats", () => {
    const bad = createPlan({
      productId: "prod_1",
      name: "  ",
      interval: "monthly",
      price: money("1"),
    });
    expect(bad.ok).toBe(false);

    const badSeats = createPlan({
      productId: "prod_1",
      name: "X",
      interval: "monthly",
      price: money("1"),
      seats: -2,
    });
    expect(badSeats.ok).toBe(false);
  });

  it("copies the features map (no aliasing)", () => {
    const features = { sso: true };
    const plan = unwrap(
      createPlan({ productId: "p", name: "N", interval: "monthly", price: money("1"), features }),
    );
    features.sso = false;
    expect(plan.features.sso).toBe(true);
  });

  it("lists plans filtered by product, sorted by creation", () => {
    const a = unwrap(
      createPlan({
        productId: "prod_a",
        name: "A",
        interval: "monthly",
        price: money("1"),
        now: new Date("2026-01-01T00:00:00.000Z"),
      }),
    );
    const b = unwrap(
      createPlan({
        productId: "prod_b",
        name: "B",
        interval: "monthly",
        price: money("1"),
        now: new Date("2026-02-01T00:00:00.000Z"),
      }),
    );
    expect(listPlans([b, a], { productId: "prod_a" })).toEqual([a]);
    expect(listPlans([b, a]).map((p) => p.name)).toEqual(["A", "B"]);
  });
});

describe("featureEnabled", () => {
  it("reads boolean flags", () => {
    const plan = pro();
    expect(featureEnabled(plan, "sso")).toBe(true);
    expect(featureEnabled(plan, "beta")).toBe(false);
  });

  it("treats positive and unlimited numeric features as enabled", () => {
    const plan = pro();
    expect(featureEnabled(plan, "projects")).toBe(true);
    expect(featureEnabled(plan, "api_calls")).toBe(true);
  });

  it("returns false for unknown keys", () => {
    expect(featureEnabled(pro(), "nope")).toBe(false);
  });
});

describe("featureLimit", () => {
  it("resolves numeric limits, unlimited, and flags", () => {
    const plan = pro();
    expect(featureLimit(plan, "projects")).toBe(10);
    expect(featureLimit(plan, "api_calls")).toBe(Infinity);
    expect(featureLimit(plan, "sso")).toBe(Infinity);
    expect(featureLimit(plan, "beta")).toBe(0);
    expect(featureLimit(plan, "missing")).toBeUndefined();
  });
});
