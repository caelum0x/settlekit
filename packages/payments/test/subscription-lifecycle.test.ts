import { describe, it, expect } from "vitest";
import { SettleKitError } from "@settlekit/common";
import {
  createSubscription,
  renewSubscription,
  enterGrace,
  cancelSubscription,
  expireSubscription,
  isGraceExpired,
} from "../src/index.js";
import { makePrice } from "./helpers.js";

const START = new Date("2026-01-15T00:00:00.000Z");

function monthlySub() {
  return createSubscription(
    {
      organizationId: "org_1",
      customerId: "cus_1",
      productId: "prod_1",
      price: makePrice({ interval: "monthly" }),
    },
    START,
  );
}

describe("createSubscription", () => {
  it("starts active with a period derived from the interval", () => {
    const s = monthlySub();
    expect(s.status).toBe("active");
    expect(s.currentPeriodStart).toBe("2026-01-15T00:00:00.000Z");
    expect(s.currentPeriodEnd).toBe("2026-02-15T00:00:00.000Z");
    expect(s.id.startsWith("sub_")).toBe(true);
    expect(s.cancelAtPeriodEnd).toBe(false);
  });

  it("supports yearly intervals", () => {
    const s = createSubscription(
      {
        organizationId: "org_1",
        customerId: "cus_1",
        productId: "prod_1",
        price: makePrice({ interval: "yearly" }),
      },
      START,
    );
    expect(s.currentPeriodEnd).toBe("2027-01-15T00:00:00.000Z");
  });

  it("rejects one_time prices", () => {
    expect(() =>
      createSubscription(
        {
          organizationId: "org_1",
          customerId: "cus_1",
          productId: "prod_1",
          price: makePrice({ interval: "one_time" }),
        },
        START,
      ),
    ).toThrow(SettleKitError);
  });
});

describe("renewSubscription advances the period", () => {
  it("rolls the period forward from the previous end", () => {
    const s = monthlySub();
    const r = renewSubscription(s, "monthly");
    expect(r).not.toBe(s);
    expect(r.status).toBe("active");
    expect(r.currentPeriodStart).toBe("2026-02-15T00:00:00.000Z");
    expect(r.currentPeriodEnd).toBe("2026-03-15T00:00:00.000Z");
    // original untouched
    expect(s.currentPeriodEnd).toBe("2026-02-15T00:00:00.000Z");
  });

  it("renews out of grace back to active and clears graceEndsAt", () => {
    const grace = enterGrace(monthlySub(), new Date("2026-02-15T00:00:00.000Z"));
    expect(grace.graceEndsAt).toBeDefined();
    const r = renewSubscription(grace, "monthly");
    expect(r.status).toBe("active");
    expect(r.graceEndsAt).toBeUndefined();
  });

  it("cancels at renewal when cancelAtPeriodEnd is set", () => {
    const scheduled = cancelSubscription(monthlySub());
    expect(scheduled.cancelAtPeriodEnd).toBe(true);
    expect(scheduled.status).toBe("active");
    const r = renewSubscription(scheduled, "monthly");
    expect(r.status).toBe("canceled");
  });

  it("refuses to renew a canceled subscription", () => {
    const canceled = cancelSubscription(monthlySub(), true);
    expect(() => renewSubscription(canceled, "monthly")).toThrow(SettleKitError);
  });
});

describe("grace logic", () => {
  it("enterGrace sets in_grace with a graceEndsAt window", () => {
    const now = new Date("2026-02-15T00:00:00.000Z");
    const g = enterGrace(monthlySub(), now, 3);
    expect(g.status).toBe("in_grace");
    expect(g.graceEndsAt).toBe("2026-02-18T00:00:00.000Z");
  });

  it("isGraceExpired is false before and true after the window", () => {
    const now = new Date("2026-02-15T00:00:00.000Z");
    const g = enterGrace(monthlySub(), now, 3);
    expect(isGraceExpired(g, new Date("2026-02-17T00:00:00.000Z"))).toBe(false);
    expect(isGraceExpired(g, new Date("2026-02-18T00:00:00.000Z"))).toBe(true);
    expect(isGraceExpired(g, new Date("2026-02-19T00:00:00.000Z"))).toBe(true);
  });

  it("isGraceExpired is false when there is no grace window", () => {
    expect(isGraceExpired(monthlySub())).toBe(false);
  });

  it("expireSubscription terminates an in_grace subscription", () => {
    const g = enterGrace(monthlySub(), new Date("2026-02-15T00:00:00.000Z"));
    const e = expireSubscription(g);
    expect(e.status).toBe("expired");
    expect(e.graceEndsAt).toBeUndefined();
  });

  it("cannot expire an active subscription", () => {
    expect(() => expireSubscription(monthlySub())).toThrow(SettleKitError);
  });
});

describe("cancelSubscription", () => {
  it("schedules cancellation at period end by default", () => {
    const c = cancelSubscription(monthlySub());
    expect(c.status).toBe("active");
    expect(c.cancelAtPeriodEnd).toBe(true);
  });

  it("cancels immediately when requested", () => {
    const c = cancelSubscription(monthlySub(), true);
    expect(c.status).toBe("canceled");
  });

  it("refuses to cancel an already-canceled subscription", () => {
    const c = cancelSubscription(monthlySub(), true);
    expect(() => cancelSubscription(c)).toThrow(SettleKitError);
  });
});
