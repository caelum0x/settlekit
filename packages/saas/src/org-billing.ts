/**
 * Organization-level billing aggregation (plan §20).
 *
 * Rolls a tenant org's active subscriptions + their plans into a billing
 * summary: how many active subs, and the total recurring revenue normalized to a
 * monthly figure (yearly plans divided by 12, computed in USDC base units).
 */
import {
  toBaseUnits,
  fromBaseUnits,
  money,
  addMoney,
} from "@settlekit/common";
import type { Money, Subscription } from "@settlekit/common";
import type { SaasPlan } from "./saas-plan.js";
import { isAccessActive } from "./grace-periods.js";

/** A subscription paired with the plan it pays for. */
export interface OrgSubscription {
  subscription: Subscription;
  plan: SaasPlan;
}

/** Aggregated billing snapshot for an organization. */
export interface OrgBillingSummary {
  organizationId: string;
  activeSubscriptions: number;
  /** Monthly recurring revenue across active subscriptions. */
  mrr: Money;
  /** Annual run-rate (mrr * 12). */
  arr: Money;
}

/** Normalize a plan's recurring price to a monthly figure in base units. */
function monthlyBaseUnits(plan: SaasPlan): bigint {
  const base = toBaseUnits(plan.price.amount);
  return plan.interval === "yearly" ? base / 12n : base;
}

/**
 * Build an {@link OrgBillingSummary} for `organizationId` from its
 * subscription/plan pairs. Only subscriptions that currently grant access
 * (active or in-grace) count toward MRR.
 */
export function orgBillingSummary(
  organizationId: string,
  subscriptions: readonly OrgSubscription[],
): OrgBillingSummary {
  const active = subscriptions.filter((s) => isAccessActive(s.subscription));

  let mrr: Money = money("0");
  for (const { plan } of active) {
    mrr = addMoney(mrr, money(fromBaseUnits(monthlyBaseUnits(plan)), plan.price.currency));
  }

  const arr = money(fromBaseUnits(toBaseUnits(mrr.amount) * 12n), mrr.currency);

  return {
    organizationId,
    activeSubscriptions: active.length,
    mrr,
    arr,
  };
}
