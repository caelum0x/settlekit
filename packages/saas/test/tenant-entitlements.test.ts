import { describe, expect, it } from "vitest";
import { unwrap, isErr, money } from "@settlekit/common";
import type { Subscription } from "@settlekit/common";
import {
  createPlan,
  tenantEntitlement,
  usageLimits,
  upgradeDowngrade,
  applyGracePeriod,
  isAccessActive,
  type SaasPlan,
} from "../src/index.js";

function plan(name: string, price: string, seats = 5): SaasPlan {
  return unwrap(
    createPlan({
      productId: "prod_1",
      name,
      interval: "monthly",
      price: money(price),
      features: { sso: true, api_calls: 1000 },
      seats,
      now: new Date("2026-01-01T00:00:00.000Z"),
    }),
  );
}

describe("tenantEntitlement", () => {
  it("builds an active saas_feature entitlement from a plan", () => {
    const ent = tenantEntitlement({
      organizationId: "org_1",
      customerId: "cus_1",
      plan: plan("Pro", "25"),
      grantedBy: { type: "subscription", id: "sub_1" },
      expiresAt: "2026-02-01T00:00:00.000Z",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(ent.entitlementType).toBe("saas_feature");
    expect(ent.status).toBe("active");
    expect(ent.features?.sso).toBe(true);
    expect(ent.features?.api_calls).toBe(1000);
    expect(ent.seats).toBe(5);
    expect(ent.expiresAt).toBe("2026-02-01T00:00:00.000Z");
    expect(ent.customerId).toBe("cus_1");
  });

  it("does not alias the plan features map", () => {
    const p = plan("Pro", "25");
    const ent = tenantEntitlement({
      organizationId: "org_1",
      customerId: "cus_1",
      plan: p,
      grantedBy: { type: "subscription", id: "sub_1" },
    });
    p.features.sso = false;
    expect(ent.features?.sso).toBe(true);
  });
});

describe("usageLimits gate", () => {
  it("allows within the limit and blocks beyond it", () => {
    const ent = tenantEntitlement({
      organizationId: "org_1",
      customerId: "cus_1",
      plan: plan("Pro", "25"),
      grantedBy: { type: "subscription", id: "sub_1" },
    });

    const ok = usageLimits(ent, "api_calls", 999, 1);
    expect(ok.allowed).toBe(true);
    expect(ok.remaining).toBe(0);

    const blocked = usageLimits(ent, "api_calls", 1000, 1);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe("limit_exceeded");

    const unmetered = usageLimits(ent, "unknown_metric", 5);
    expect(unmetered.allowed).toBe(true);
    expect(unmetered.reason).toBe("no_limit");
  });
});

function subscription(): Subscription {
  return {
    id: "sub_1",
    organizationId: "org_1",
    customerId: "cus_1",
    productId: "prod_1",
    priceId: "price_1",
    status: "active",
    currentPeriodStart: "2026-01-01T00:00:00.000Z",
    currentPeriodEnd: "2026-01-31T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("upgradeDowngrade proration", () => {
  it("charges the net difference for a mid-cycle upgrade", () => {
    // 30-day period (Jan 1 -> Jan 31). At the halfway point, 15 days remain.
    const result = upgradeDowngrade({
      currentSub: subscription(),
      currentPlan: plan("Basic", "30"),
      newPlan: plan("Pro", "60"),
      now: new Date("2026-01-16T00:00:00.000Z"),
    });
    expect(result.ok).toBe(true);
    const proration = unwrap(result);
    expect(proration.kind).toBe("upgrade");
    // Half the cycle remains: unused credit ~15, new charge ~30, net ~15.
    expect(proration.remainingFraction).toBeCloseTo(0.5, 5);
    expect(proration.unusedCredit.amount).toBe("15");
    expect(proration.newPlanCharge.amount).toBe("30");
    expect(proration.amountDue.amount).toBe("15");
  });

  it("credits the buyer for a downgrade (negative amountDue)", () => {
    const result = upgradeDowngrade({
      currentSub: subscription(),
      currentPlan: plan("Pro", "60"),
      newPlan: plan("Basic", "30"),
      now: new Date("2026-01-16T00:00:00.000Z"),
    });
    const proration = unwrap(result);
    expect(proration.kind).toBe("downgrade");
    expect(proration.amountDue.amount).toBe("-15");
  });

  it("rejects a now outside the subscription window", () => {
    const result = upgradeDowngrade({
      currentSub: subscription(),
      currentPlan: plan("Basic", "30"),
      newPlan: plan("Pro", "60"),
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    expect(isErr(result)).toBe(true);
  });
});

describe("grace period lifecycle", () => {
  it("stays active before the period ends", () => {
    const next = applyGracePeriod({
      subscription: subscription(),
      graceDays: 3,
      renewed: false,
      now: new Date("2026-01-15T00:00:00.000Z"),
    });
    expect(next.status).toBe("active");
    expect(isAccessActive(next)).toBe(true);
  });

  it("enters grace when the period ends without renewal", () => {
    const next = applyGracePeriod({
      subscription: subscription(),
      graceDays: 3,
      renewed: false,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(next.status).toBe("in_grace");
    expect(next.graceEndsAt).toBe("2026-02-03T00:00:00.000Z");
    expect(isAccessActive(next)).toBe(true);
  });

  it("expires once the grace window elapses", () => {
    const inGrace = applyGracePeriod({
      subscription: subscription(),
      graceDays: 3,
      renewed: false,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    const expired = applyGracePeriod({
      subscription: inGrace,
      graceDays: 3,
      renewed: false,
      now: new Date("2026-02-10T00:00:00.000Z"),
    });
    expect(expired.status).toBe("expired");
    expect(isAccessActive(expired)).toBe(false);
  });

  it("returns to active on renewal and clears grace", () => {
    const inGrace = applyGracePeriod({
      subscription: subscription(),
      graceDays: 3,
      renewed: false,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    const renewed = applyGracePeriod({
      subscription: inGrace,
      graceDays: 3,
      renewed: true,
      now: new Date("2026-02-02T00:00:00.000Z"),
    });
    expect(renewed.status).toBe("active");
    expect(renewed.graceEndsAt).toBeUndefined();
  });
});
