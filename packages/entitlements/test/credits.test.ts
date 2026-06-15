import { SettleKitError } from "@settlekit/common";
import { describe, expect, it } from "vitest";
import { addCredits, deductCredits } from "../src/index.js";
import { makeEntitlement } from "./fixtures.js";

describe("deductCredits", () => {
  it("returns a new entitlement with the reduced balance (immutable)", () => {
    const ent = makeEntitlement({ creditsRemaining: 20 });
    const after = deductCredits(ent, 5);

    expect(after.creditsRemaining).toBe(15);
    expect(ent.creditsRemaining).toBe(20);
    expect(after).not.toBe(ent);
  });

  it("can deduct the entire balance", () => {
    const ent = makeEntitlement({ creditsRemaining: 7 });
    expect(deductCredits(ent, 7).creditsRemaining).toBe(0);
  });

  it("throws SettleKitError insufficient_credits when short", () => {
    const ent = makeEntitlement({ creditsRemaining: 3 });
    try {
      deductCredits(ent, 10);
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SettleKitError);
      expect((error as SettleKitError).code).toBe("insufficient_credits");
      expect((error as SettleKitError).details).toMatchObject({ available: 3, requested: 10 });
    }
  });

  it("bumps updatedAt", () => {
    const ent = makeEntitlement({ updatedAt: "2026-01-01T00:00:00.000Z" });
    const after = deductCredits(ent, 1, new Date("2026-06-15T12:00:00.000Z"));
    expect(after.updatedAt).toBe("2026-06-15T12:00:00.000Z");
  });
});

describe("addCredits", () => {
  it("adds to the balance immutably", () => {
    const ent = makeEntitlement({ creditsRemaining: 20 });
    expect(addCredits(ent, 30).creditsRemaining).toBe(50);
    expect(ent.creditsRemaining).toBe(20);
  });

  it("treats a missing balance as zero", () => {
    const ent = makeEntitlement({ creditsRemaining: undefined });
    expect(addCredits(ent, 5).creditsRemaining).toBe(5);
  });
});
