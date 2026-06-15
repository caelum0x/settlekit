import { describe, expect, it } from "vitest";
import { checkSeat, verifyCredits, verifyFeature } from "../src/index.js";
import { makeEntitlement } from "./fixtures.js";

describe("verifyFeature", () => {
  it("allows a boolean-true feature", () => {
    expect(verifyFeature(makeEntitlement(), "ai_export")).toEqual({ allowed: true, value: true });
  });

  it("denies a boolean-false feature", () => {
    const ent = makeEntitlement({ features: { ai_export: false } });
    expect(verifyFeature(ent, "ai_export")).toMatchObject({ allowed: false, reason: "feature_disabled" });
  });

  it("allows a positive numeric limit", () => {
    expect(verifyFeature(makeEntitlement(), "max_projects")).toEqual({ allowed: true, value: 10 });
  });

  it("denies a zero numeric limit", () => {
    const ent = makeEntitlement({ features: { max_projects: 0 } });
    expect(verifyFeature(ent, "max_projects")).toMatchObject({ allowed: false, reason: "limit_exhausted" });
  });

  it("denies an unknown feature", () => {
    expect(verifyFeature(makeEntitlement(), "nope")).toMatchObject({ allowed: false, reason: "feature_not_granted" });
  });

  it("denies when there are no features at all", () => {
    const ent = makeEntitlement({ features: undefined });
    expect(verifyFeature(ent, "ai_export")).toMatchObject({ allowed: false, reason: "feature_not_granted" });
  });
});

describe("verifyCredits", () => {
  it("allows when balance covers the amount", () => {
    expect(verifyCredits(makeEntitlement(), 5)).toEqual({ allowed: true, value: 20 });
  });

  it("denies when balance is short", () => {
    expect(verifyCredits(makeEntitlement(), 50)).toMatchObject({ allowed: false, reason: "insufficient_credits" });
  });

  it("treats a missing balance as zero", () => {
    const ent = makeEntitlement({ creditsRemaining: undefined });
    expect(verifyCredits(ent, 1)).toMatchObject({ allowed: false });
  });

  it("throws on non-positive amounts", () => {
    expect(() => verifyCredits(makeEntitlement(), 0)).toThrow(RangeError);
    expect(() => verifyCredits(makeEntitlement(), -3)).toThrow(RangeError);
  });
});

describe("checkSeat", () => {
  it("allows when under the seat limit", () => {
    expect(checkSeat(makeEntitlement(), 3)).toEqual({ allowed: true, value: 2 });
  });

  it("denies when at the seat limit", () => {
    expect(checkSeat(makeEntitlement(), 5)).toMatchObject({ allowed: false, reason: "seat_limit_reached" });
  });

  it("denies when there is no seat allotment", () => {
    const ent = makeEntitlement({ seats: undefined });
    expect(checkSeat(ent, 0)).toMatchObject({ allowed: false, reason: "no_seat_allotment" });
  });

  it("rejects invalid used-seat counts", () => {
    expect(checkSeat(makeEntitlement(), -1)).toMatchObject({ allowed: false, reason: "invalid_seat_count" });
  });
});
