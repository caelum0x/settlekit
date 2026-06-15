import { describe, it, expect } from "vitest";
import { SettleKitError } from "@settlekit/common";
import {
  computeCheckoutTotal,
  createCheckoutSession,
  collectFields,
  expireSession,
  completeSession,
  cancelSession,
  isSessionExpired,
} from "../src/index.js";
import { makePrice, makeItem } from "./helpers.js";

const NOW = new Date("2026-06-15T00:00:00.000Z");

describe("computeCheckoutTotal", () => {
  it("sums price * quantity across line items", () => {
    const a = makePrice({ amount: "10" });
    const b = makePrice({ amount: "2.5" });
    const total = computeCheckoutTotal([makeItem(a, 2), makeItem(b, 3)]);
    // 10*2 + 2.5*3 = 20 + 7.5 = 27.5
    expect(total).toEqual({ amount: "27.5", currency: "USDC" });
  });

  it("handles sub-cent USDC precision without floating point drift", () => {
    const p = makePrice({ amount: "0.000001" });
    const total = computeCheckoutTotal([makeItem(p, 3)]);
    expect(total.amount).toBe("0.000003");
  });

  it("excludes usage-based prices from the upfront total", () => {
    const flat = makePrice({ amount: "10" });
    const metered = makePrice({
      amount: "0",
      usageBased: true,
      unitAmount: "0.01",
    });
    const total = computeCheckoutTotal([makeItem(flat, 1), makeItem(metered, 100)]);
    expect(total.amount).toBe("10");
  });

  it("rejects non-positive quantities", () => {
    const p = makePrice({ amount: "10" });
    expect(() => computeCheckoutTotal([makeItem(p, 0)])).toThrow(SettleKitError);
  });
});

describe("createCheckoutSession", () => {
  const base = {
    organizationId: "org_1",
    merchantId: "mch_1",
    payToAddress: "0xabc",
    network: "arc" as const,
  };

  it("computes amount, sets status open and expiresAt", () => {
    const p = makePrice({ amount: "15" });
    const session = createCheckoutSession(
      { ...base, items: [makeItem(p, 2)] },
      NOW,
    );
    expect(session.status).toBe("open");
    expect(session.amount.amount).toBe("30");
    expect(session.payToAddress).toBe("0xabc");
    expect(session.id.startsWith("cs_")).toBe(true);
    // default TTL is 1 day
    expect(session.expiresAt).toBe("2026-06-16T00:00:00.000Z");
    expect(session.createdAt).toBe(NOW.toISOString());
  });

  it("honours a custom ttlDays", () => {
    const p = makePrice({ amount: "1" });
    const session = createCheckoutSession(
      { ...base, items: [makeItem(p)], ttlDays: 7 },
      NOW,
    );
    expect(session.expiresAt).toBe("2026-06-22T00:00:00.000Z");
  });

  it("rejects an empty cart", () => {
    expect(() =>
      createCheckoutSession({ ...base, items: [] }, NOW),
    ).toThrow(SettleKitError);
  });

  it("does not mutate the input line items array", () => {
    const p = makePrice({ amount: "5" });
    const item = makeItem(p);
    const items = [item];
    const session = createCheckoutSession({ ...base, items }, NOW);
    session.lineItems[0]!.quantity = 99;
    expect(item.lineItem.quantity).toBe(1);
  });
});

describe("collectFields", () => {
  const base = {
    organizationId: "org_1",
    merchantId: "mch_1",
    payToAddress: "0xabc",
    network: "arc" as const,
  };

  it("merges fields immutably", () => {
    const session = createCheckoutSession(
      { ...base, items: [makeItem(makePrice())] },
      NOW,
    );
    const updated = collectFields(session, { github: "octocat" });
    expect(updated).not.toBe(session);
    expect(session.collectedFields).toEqual({});
    expect(updated.collectedFields).toEqual({ github: "octocat" });
  });

  it("refuses to collect on a non-open session", () => {
    const session = createCheckoutSession(
      { ...base, items: [makeItem(makePrice())] },
      NOW,
    );
    const expired = expireSession(session);
    expect(() => collectFields(expired, { x: "y" })).toThrow(SettleKitError);
  });
});

describe("session transitions", () => {
  const base = {
    organizationId: "org_1",
    merchantId: "mch_1",
    payToAddress: "0xabc",
    network: "arc" as const,
  };
  const open = () =>
    createCheckoutSession({ ...base, items: [makeItem(makePrice())] }, NOW);

  it("expireSession returns a new expired session", () => {
    const s = open();
    const e = expireSession(s);
    expect(e).not.toBe(s);
    expect(e.status).toBe("expired");
    expect(s.status).toBe("open");
  });

  it("expireSession is idempotent", () => {
    const e = expireSession(open());
    expect(expireSession(e)).toBe(e);
  });

  it("completeSession only from open", () => {
    const c = completeSession(open());
    expect(c.status).toBe("completed");
    expect(() => completeSession(cancelSession(open()))).toThrow(SettleKitError);
  });

  it("isSessionExpired compares against expiresAt", () => {
    const s = open();
    expect(isSessionExpired(s, NOW)).toBe(false);
    expect(isSessionExpired(s, new Date("2026-06-17T00:00:00.000Z"))).toBe(true);
  });
});
