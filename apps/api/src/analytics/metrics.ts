/**
 * Growth metrics for the merchant dashboard: checkout conversion, per-link
 * performance, subscription churn and customer lifetime value. Pure: callers
 * pass the org's sessions, payments, subscriptions and catalog. Money is exact
 * (bigint base units); rates are fractions rounded to 4 decimals.
 */
import { fromBaseUnits, toBaseUnits, type CheckoutSession, type Payment, type Price, type Product, type Subscription } from "@settlekit/common";

export interface LinkStats {
  productId: string;
  name: string;
  slug: string | null;
  opened: number;
  paid: number;
  conversion: number;
  revenue: string;
}

export interface GrowthMetrics {
  windowDays: number;
  checkouts: { opened: number; paid: number; conversion: number };
  links: LinkStats[];
  revenue: { window: string; allTime: string };
  customers: { paying: number; repeat: number; repeatRate: number };
  /** Average all-time revenue per paying customer. */
  averageRevenuePerCustomer: string;
  subscriptions: {
    active: number;
    churned: number;
    churnRate: number;
    /** Average monthly revenue per active subscription. */
    arpu: string;
    /** arpu / monthly churn, null while no subscription has churned. */
    estimatedLifetimeValue: string | null;
  };
}

const DAY_MS = 86_400_000;

function rate(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 10_000) / 10_000;
}

function sum(payments: readonly Payment[]): bigint {
  return payments.reduce((acc, p) => acc + toBaseUnits(p.amount.amount), 0n);
}

export interface MetricsInput {
  sessions: readonly CheckoutSession[];
  /** Confirmed (and refunded) payments of the org, all time. */
  payments: readonly Payment[];
  subscriptions: readonly Subscription[];
  products: readonly Product[];
  prices: readonly Price[];
  now: Date;
  days: number;
}

export function computeGrowthMetrics(input: MetricsInput): GrowthMetrics {
  const start = input.now.getTime() - input.days * DAY_MS;
  const confirmed = input.payments.filter((p) => p.status === "confirmed");
  const inWindow = confirmed.filter((p) => Date.parse(p.confirmedAt ?? p.createdAt) >= start);
  const paidSessionIds = new Set(confirmed.map((p) => p.checkoutSessionId));
  const sessions = input.sessions.filter((s) => Date.parse(s.createdAt) >= start && s.invoiceId === undefined);
  const paidSessions = sessions.filter((s) => s.status === "completed" || paidSessionIds.has(s.id));

  // Per payment link (first line's product).
  const byProduct = new Map<string, { opened: number; paid: number; revenue: bigint }>();
  const revenueBySession = new Map<string, bigint>();
  for (const p of confirmed) revenueBySession.set(p.checkoutSessionId, (revenueBySession.get(p.checkoutSessionId) ?? 0n) + toBaseUnits(p.amount.amount));
  for (const s of sessions) {
    const productId = s.lineItems[0]?.productId;
    if (!productId) continue;
    const row = byProduct.get(productId) ?? { opened: 0, paid: 0, revenue: 0n };
    row.opened += 1;
    if (s.status === "completed" || paidSessionIds.has(s.id)) {
      row.paid += 1;
      row.revenue += revenueBySession.get(s.id) ?? 0n;
    }
    byProduct.set(productId, row);
  }
  const productsById = new Map(input.products.map((p) => [p.id, p]));
  const links: LinkStats[] = [...byProduct.entries()]
    .map(([productId, row]) => {
      const product = productsById.get(productId);
      const slug = product?.metadata.paymentLinkSlug;
      return {
        productId,
        name: product?.name ?? productId,
        slug: typeof slug === "string" ? slug : null,
        opened: row.opened,
        paid: row.paid,
        conversion: rate(row.paid, row.opened),
        revenue: fromBaseUnits(row.revenue),
      };
    })
    .sort((a, b) => b.opened - a.opened);

  // Customers.
  const perCustomer = new Map<string, number>();
  for (const p of confirmed) perCustomer.set(p.customerId, (perCustomer.get(p.customerId) ?? 0) + 1);
  const paying = perCustomer.size;
  const repeat = [...perCustomer.values()].filter((n) => n >= 2).length;
  const allTime = sum(confirmed);

  // Subscriptions: churn over the window, ARPU and a simple LTV estimate.
  const pricesById = new Map(input.prices.map((p) => [p.id, p]));
  const active = input.subscriptions.filter((s) => s.status === "active" || s.status === "past_due" || s.status === "in_grace");
  const churned = input.subscriptions.filter(
    (s) => (s.status === "canceled" || s.status === "expired") && Date.parse(s.currentPeriodEnd) >= start && Date.parse(s.currentPeriodEnd) <= input.now.getTime(),
  );
  let mrr = 0n;
  for (const s of active) {
    const price = pricesById.get(s.priceId);
    if (!price) continue;
    const base = toBaseUnits(price.amount);
    mrr += price.interval === "yearly" ? base / 12n : base;
  }
  const churnRate = rate(churned.length, active.length + churned.length);
  const arpu = active.length === 0 ? 0n : mrr / BigInt(active.length);
  const monthlyChurn = churnRate === 0 ? 0 : Math.min(1, (churnRate * 30) / input.days);
  const ltv = monthlyChurn === 0 ? null : fromBaseUnits(BigInt(Math.round(Number(arpu) / monthlyChurn)));

  return {
    windowDays: input.days,
    checkouts: { opened: sessions.length, paid: paidSessions.length, conversion: rate(paidSessions.length, sessions.length) },
    links,
    revenue: { window: fromBaseUnits(sum(inWindow)), allTime: fromBaseUnits(allTime) },
    customers: { paying, repeat, repeatRate: rate(repeat, paying) },
    averageRevenuePerCustomer: paying === 0 ? "0" : fromBaseUnits(allTime / BigInt(paying)),
    subscriptions: {
      active: active.length,
      churned: churned.length,
      churnRate,
      arpu: fromBaseUnits(arpu),
      estimatedLifetimeValue: ltv,
    },
  };
}
