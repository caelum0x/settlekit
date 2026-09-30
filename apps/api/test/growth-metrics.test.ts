import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { money, type CheckoutSession, type Payment, type Price, type Product, type Subscription } from "@settlekit/common";
import type { SettlementVerifier } from "@settlekit/chains";
import { computeGrowthMetrics } from "../src/analytics/metrics.js";
import { createApp } from "../src/app.js";
import { createContext } from "../src/context.js";

const NOW = new Date("2026-09-30T00:00:00.000Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function session(id: string, productId: string, createdDaysAgo: number, status: CheckoutSession["status"] = "open"): CheckoutSession {
  return {
    id,
    organizationId: "org_1",
    merchantId: "m",
    lineItems: [{ productId, priceId: `price_${productId}`, quantity: 1 }],
    amount: money("10"),
    status,
    payToAddress: "0x",
    network: "base",
    expiresAt: day(createdDaysAgo - 1),
    collectedFields: {},
    createdAt: day(createdDaysAgo),
  };
}

function payment(id: string, sessionId: string, customerId: string, amount: string, daysAgo: number): Payment {
  return {
    id,
    organizationId: "org_1",
    checkoutSessionId: sessionId,
    customerId,
    amount: money(amount),
    network: "base",
    confirmations: 3,
    status: "confirmed",
    createdAt: day(daysAgo),
    confirmedAt: day(daysAgo),
  };
}

function sub(id: string, status: Subscription["status"], periodEndDaysAgo: number): Subscription {
  return {
    id,
    organizationId: "org_1",
    customerId: "c",
    productId: "prod_sub",
    priceId: "price_sub",
    status,
    currentPeriodStart: day(periodEndDaysAgo + 30),
    currentPeriodEnd: day(periodEndDaysAgo),
    cancelAtPeriodEnd: false,
    createdAt: day(100),
  };
}

describe("growth metrics", () => {
  it("computes conversion, per-link stats, repeat customers, churn and LTV", () => {
    const sessions = [
      session("s1", "prod_a", 3, "completed"),
      session("s2", "prod_a", 2),
      session("s3", "prod_a", 1, "completed"),
      session("s4", "prod_b", 5),
      session("s_old", "prod_a", 60, "completed"),
      { ...session("s_inv", "prod_inv", 1, "completed"), invoiceId: "inv_1" },
    ];
    const payments = [
      payment("p1", "s1", "cus_1", "10", 3),
      payment("p3", "s3", "cus_1", "10", 1),
      payment("p_old", "s_old", "cus_2", "20", 60),
    ];
    const products = [
      { id: "prod_a", name: "Course", metadata: { paymentLinkSlug: "course-1" } },
      { id: "prod_b", name: "Kit", metadata: {} },
    ] as unknown as Product[];
    const prices = [{ id: "price_sub", productId: "prod_sub", amount: "30", interval: "monthly" }] as unknown as Price[];
    const subscriptions = [sub("a1", "active", -10), sub("a2", "active", -5), sub("a3", "active", -3), sub("c1", "canceled", 5)];

    const m = computeGrowthMetrics({ sessions, payments, subscriptions, products, prices, now: NOW, days: 30 });
    expect(m.checkouts).toEqual({ opened: 4, paid: 2, conversion: 0.5 });
    expect(m.links[0]).toEqual({ productId: "prod_a", name: "Course", slug: "course-1", opened: 3, paid: 2, conversion: 0.6667, revenue: "20" });
    expect(m.links[1]).toMatchObject({ productId: "prod_b", opened: 1, paid: 0, conversion: 0 });
    expect(m.revenue).toEqual({ window: "20", allTime: "40" });
    expect(m.customers).toEqual({ paying: 2, repeat: 1, repeatRate: 0.5 });
    expect(m.averageRevenuePerCustomer).toBe("20");
    expect(m.subscriptions).toMatchObject({ active: 3, churned: 1, churnRate: 0.25, arpu: "30" });
    expect(m.subscriptions.estimatedLifetimeValue).toBe("120");
  });

  it("handles an empty account", () => {
    const m = computeGrowthMetrics({ sessions: [], payments: [], subscriptions: [], products: [], prices: [], now: NOW, days: 7 });
    expect(m.checkouts.conversion).toBe(0);
    expect(m.subscriptions.estimatedLifetimeValue).toBeNull();
    expect(m.averageRevenuePerCustomer).toBe("0");
  });

  it("serves /v1/analytics/metrics from live data", async () => {
    process.env.API_BOOTSTRAP_KEY = "test-bootstrap-key";
    const base = await createContext();
    const ok: SettlementVerifier = async (proof, req) => (proof.network === req.network ? { ok: true } : { ok: false });
    const app = createApp({ ...base, verifiers: { ...base.verifiers, base: ok } });
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await app.request(path, {
        method,
        headers: { authorization: "Bearer test-bootstrap-key", "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return (await res.json()) as { data?: any };
    };
    const product = await call("POST", "/v1/products", { merchantId: "m", name: "Guide", type: "license_key", deliveryMode: "license_key" });
    const price = await call("POST", `/v1/products/${product.data.id}/prices`, { amount: "9" });
    const customer = await call("POST", "/v1/customers", { email: "a@b.test" });
    const open = async () =>
      call("POST", "/v1/checkout-sessions", {
        merchantId: "m",
        customerId: customer.data.id,
        items: [{ priceId: price.data.id, productId: product.data.id, quantity: 1 }],
        payToAddress: "0x1111111111111111111111111111111111111111",
        network: "base",
      });
    const s1 = await open();
    await open();
    const pay = await call("POST", "/v1/payments", { checkoutSessionId: s1.data.id });
    await call("POST", `/v1/payments/${pay.data.id}/confirm`, { txHash: `0x${randomBytes(32).toString("hex")}`, confirmations: 3 });
    const metrics = await call("GET", "/v1/analytics/metrics?days=7");
    expect(metrics.data.checkouts).toEqual({ opened: 2, paid: 1, conversion: 0.5 });
    expect(metrics.data.links[0]).toMatchObject({ name: "Guide", opened: 2, paid: 1, revenue: "9" });
  });
});
