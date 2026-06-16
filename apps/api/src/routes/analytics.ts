/**
 * Analytics routes — a real merchant dashboard summary computed from live data.
 *
 *   GET /v1/analytics/summary?organizationId=
 *
 * Every figure is derived from the actual stores (no precomputed mock):
 *   - revenue        sum of confirmed payments for the org
 *   - revenueSeries  daily confirmed-payment totals over the last 14 days
 *   - customers      total customers
 *   - activeAccess   active entitlements across all customers
 *   - mrr            normalized monthly recurring revenue of active subscriptions
 *   - expiringSubscriptions  subs in grace or ending within 7 days
 *   - failedDeliveries       delivery runs in a failed / partially-failed state
 */
import { Hono } from "hono";
import {
  addMoney,
  fromBaseUnits,
  money,
  toBaseUnits,
  isPast,
  type Money,
  type Payment,
} from "@settlekit/common";
import type { AppEnv, AppContext } from "../context.js";
import { data } from "../http/respond.js";
import { requireOrg } from "../http/tenant.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Sum a list of payments into a single Money (USDC). */
function sumPayments(payments: readonly Payment[]): Money {
  return payments.reduce<Money>((acc, p) => addMoney(acc, p.amount), money("0"));
}

/** Build a 14-day daily revenue series (major-unit numbers) from confirmed payments. */
function revenueSeries(payments: readonly Payment[], now: Date): { date: string; amount: number }[] {
  const byDay = new Map<string, bigint>();
  for (const p of payments) {
    const stamp = p.confirmedAt ? new Date(p.confirmedAt) : new Date(p.createdAt);
    const key = stamp.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0n) + toBaseUnits(p.amount.amount));
  }
  const series: { date: string; amount: number }[] = [];
  for (let i = 13; i >= 0; i -= 1) {
    const date = new Date(now.getTime() - i * DAY_MS).toISOString().slice(0, 10);
    const base = byDay.get(date) ?? 0n;
    series.push({ date, amount: Number(fromBaseUnits(base)) });
  }
  return series;
}

/** Normalize a subscription's price to a monthly amount in base units. */
function monthlyBaseUnits(amount: string, interval: string | undefined): bigint {
  const base = toBaseUnits(amount);
  return interval === "yearly" ? base / 12n : base;
}

/** Compute the full dashboard summary from live stores. */
async function computeSummary(ctx: AppContext, organizationId: string, now: Date) {
  // Tenant-scoped: every figure is for the authenticated org only. Customers and
  // delivery runs are filtered by org so the summary never counts other tenants'
  // data (entitlements + subscriptions are then resolved per the org's customers).
  const [customers, confirmedPayments, deliveryRuns] = await Promise.all([
    ctx.customers.list((cu) => cu.organizationId === organizationId),
    ctx.payments.findConfirmedByOrganization(organizationId),
    ctx.deliveryRuns.list((r) => r.organizationId === organizationId),
  ]);

  const orgPayments = confirmedPayments;
  const revenue = sumPayments(orgPayments);

  let activeAccess = 0;
  let mrrBase = 0n;
  let expiringSubscriptions = 0;
  const soon = new Date(now.getTime() + 7 * DAY_MS);

  for (const customer of customers) {
    const [entitlements, subscriptions] = await Promise.all([
      ctx.entitlementRepo.listByCustomer(customer.id, { activeOnly: true }),
      ctx.subscriptions.findByCustomerId(customer.id),
    ]);
    activeAccess += entitlements.length;

    for (const sub of subscriptions) {
      if (sub.status === "canceled" || sub.status === "expired") continue;
      // Expiring: in grace, or period ends within the next 7 days.
      if (sub.status === "in_grace" || (!isPast(sub.currentPeriodEnd, now) && isPast(sub.currentPeriodEnd, soon))) {
        expiringSubscriptions += 1;
      }
      if (sub.status === "active" || sub.status === "past_due" || sub.status === "in_grace") {
        const price = await ctx.prices.findById(sub.priceId);
        if (price) mrrBase += monthlyBaseUnits(price.amount, price.interval);
      }
    }
  }

  const failedDeliveries = deliveryRuns.filter(
    (r) => r.status === "failed" || r.status === "partially_failed",
  ).length;

  return {
    revenue,
    customers: customers.length,
    activeAccess,
    expiringSubscriptions,
    failedDeliveries,
    mrr: money(fromBaseUnits(mrrBase)),
    revenueSeries: revenueSeries(orgPayments, now),
  };
}

export function analyticsRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/summary", async (c) => {
    const ctx = c.get("ctx");
    // Tenant-scoped: summary for the authenticated organization.
    const summary = await computeSummary(ctx, requireOrg(c), new Date());
    return data(c, summary);
  });

  return app;
}
