import { describe, expect, it } from "vitest";
import { InMemoryOnchainBillingStore, decideClaim } from "../src/store.js";
import type { OnchainCharge } from "../src/types.js";
import { T0, subscriptionFixture } from "./helpers.js";

const input = (overrides: Partial<Parameters<typeof decideClaim>[1]> = {}) => ({
  subscription: subscriptionFixture(),
  periodIndex: 0,
  now: T0,
  leaseMs: 60_000,
  newId: () => "och_new",
  ...overrides,
});

function charge(overrides: Partial<OnchainCharge>): OnchainCharge {
  return {
    id: "och_1",
    onchainSubscriptionId: "osub_1",
    periodIndex: 0,
    network: "base",
    method: "permit2",
    amount: "9990000",
    status: "pending",
    attempt: 1,
    leaseUntil: new Date(T0.getTime() + 60_000).toISOString(),
    steps: [],
    createdAt: T0.toISOString(),
    updatedAt: T0.toISOString(),
    ...overrides,
  };
}

describe("decideClaim", () => {
  it("creates a leased pending charge for a new period", () => {
    const result = decideClaim(undefined, input());
    expect(result.kind).toBe("claimed");
    expect(result.charge).toMatchObject({ id: "och_new", status: "pending", attempt: 1, amount: "9990000" });
  });

  it("never re-claims a succeeded or invoiced period", () => {
    expect(decideClaim(charge({ status: "succeeded" }), input()).kind).toBe("already_succeeded");
    expect(decideClaim(charge({ status: "awaiting_payment" }), input()).kind).toBe("awaiting_payment");
  });

  it("respects a live lease and resumes an expired one with its steps", () => {
    const steps = [{ step: "transfer", txHash: "0xabc", at: T0.toISOString() }];
    expect(decideClaim(charge({ steps }), input()).kind).toBe("in_flight");
    const later = new Date(T0.getTime() + 120_000);
    const resumed = decideClaim(charge({ steps }), input({ now: later }));
    expect(resumed.kind).toBe("claimed");
    expect(resumed.charge.steps).toEqual(steps);
    expect(resumed.charge.attempt).toBe(1);
  });

  it("retries a failed period as the next attempt with fresh steps", () => {
    const result = decideClaim(charge({ status: "failed", failureReason: "x", steps: [{ step: "transfer", txHash: "0x1", at: "" }] }), input());
    expect(result.kind).toBe("claimed");
    expect(result.charge).toMatchObject({ status: "pending", attempt: 2, steps: [] });
    expect(result.charge.failureReason).toBeUndefined();
  });
});

describe("InMemoryOnchainBillingStore", () => {
  it("serializes concurrent claims: exactly one winner", async () => {
    const store = new InMemoryOnchainBillingStore();
    let n = 0;
    const results = await Promise.all(
      Array.from({ length: 20 }, () => store.claimCharge(input({ newId: () => `och_${++n}` }))),
    );
    expect(results.filter((r) => r.kind === "claimed")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "in_flight")).toHaveLength(19);
  });

  it("returns defensive copies and filters subscriptions", async () => {
    const store = new InMemoryOnchainBillingStore();
    const saved = await store.saveSubscription(subscriptionFixture());
    saved.status = "canceled";
    expect((await store.getSubscription("osub_1"))?.status).toBe("active");
    await store.saveSubscription(subscriptionFixture({ id: "osub_2", status: "pending_grant", grant: undefined }));
    expect((await store.listBillable()).map((s) => s.id)).toEqual([]);
    await store.saveSubscription(subscriptionFixture({ id: "osub_3", grant: { kind: "renewal_invoice", email: "a@b.co" } }));
    expect((await store.listBillable()).map((s) => s.id)).toEqual(["osub_3"]);
    expect(await store.listSubscriptions({ status: "pending_grant" })).toHaveLength(1);
  });
});
