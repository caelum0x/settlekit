import { SettleKitError } from "@settlekit/common";
import { describe, expect, it } from "vitest";

import { consumeCredits, createBalance, grantCredits, hasCredits } from "../src/index.js";

const ref = {
  organizationId: "org_1",
  customerId: "cus_1",
  productId: "prod_1",
} as const;

describe("createBalance", () => {
  it("opens an empty balance by default", () => {
    const bal = createBalance(ref);
    expect(bal.creditsRemaining).toBe(0);
    expect(bal.creditsGranted).toBe(0);
  });

  it("supports an opening grant", () => {
    const bal = createBalance({ ...ref, initialCredits: 100 });
    expect(bal.creditsRemaining).toBe(100);
    expect(bal.creditsGranted).toBe(100);
  });
});

describe("grantCredits", () => {
  it("advances remaining and lifetime granted without mutating the original", () => {
    const bal = createBalance({ ...ref, initialCredits: 10 });
    const after = grantCredits(bal, 5);

    expect(bal.creditsRemaining).toBe(10);
    expect(after.creditsRemaining).toBe(15);
    expect(after.creditsGranted).toBe(15);
    expect(after).not.toBe(bal);
  });

  it("rejects a negative grant", () => {
    const bal = createBalance(ref);
    expect(() => grantCredits(bal, -1)).toThrow();
  });
});

describe("consumeCredits", () => {
  it("decrements remaining and leaves granted unchanged", () => {
    const bal = createBalance({ ...ref, initialCredits: 10 });
    const after = consumeCredits(bal, 4);

    expect(after.creditsRemaining).toBe(6);
    expect(after.creditsGranted).toBe(10);
    expect(bal.creditsRemaining).toBe(10);
  });

  it("allows draining the balance exactly to zero", () => {
    const bal = createBalance({ ...ref, initialCredits: 3 });
    const after = consumeCredits(bal, 3);
    expect(after.creditsRemaining).toBe(0);
  });

  it("throws insufficient_credits when over-consuming", () => {
    const bal = createBalance({ ...ref, initialCredits: 2 });
    try {
      consumeCredits(bal, 5);
      throw new Error("expected consumeCredits to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SettleKitError);
      expect((error as SettleKitError).code).toBe("insufficient_credits");
      expect((error as SettleKitError).details).toMatchObject({ requested: 5, remaining: 2 });
    }
  });
});

describe("hasCredits", () => {
  it("reports coverage correctly", () => {
    const bal = createBalance({ ...ref, initialCredits: 5 });
    expect(hasCredits(bal, 5)).toBe(true);
    expect(hasCredits(bal, 6)).toBe(false);
  });
});
