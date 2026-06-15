/**
 * Plan upgrade / downgrade with proration (plan §20).
 *
 * When a tenant switches plans mid-cycle we compute the prorated credit for the
 * unused portion of the current plan and the prorated charge for the remainder
 * of the cycle on the new plan. The net amount (positive = charge buyer,
 * negative = credit buyer) is computed in USDC base units to avoid any floating
 * point drift, then surfaced as a {@link Money} value.
 */
import {
  toBaseUnits,
  fromBaseUnits,
  money,
  USDC_SCALE,
  validationError,
  ok,
  err,
} from "@settlekit/common";
import type { Money, Subscription, Result, SettleKitError } from "@settlekit/common";
import type { SaasPlan } from "./saas-plan.js";

/** Direction of a plan change. */
export type ChangeKind = "upgrade" | "downgrade" | "no_change";

/** Result of an upgrade/downgrade computation. */
export interface ProrationResult {
  kind: ChangeKind;
  /** Net amount owed by the buyer now (negative => credit owed to buyer). */
  amountDue: Money;
  /** Unused credit from the current plan for the remaining cycle. */
  unusedCredit: Money;
  /** Prorated charge for the new plan over the remaining cycle. */
  newPlanCharge: Money;
  /** Fraction of the billing cycle remaining, 0..1. */
  remainingFraction: number;
  newPlan: SaasPlan;
}

/** Input for {@link upgradeDowngrade}. */
export interface UpgradeDowngradeInput {
  /** The buyer's current subscription (defines the billing window). */
  currentSub: Subscription;
  /** The plan the buyer currently pays for. */
  currentPlan: SaasPlan;
  /** The plan to switch to. */
  newPlan: SaasPlan;
  /** "Now" — must fall within the subscription period. */
  now?: Date;
}

/** Multiply a base-unit amount by a 0..1 fraction with banker-free rounding. */
function proratedBaseUnits(amount: Money, remainingMs: number, totalMs: number): bigint {
  const base = toBaseUnits(amount.amount);
  // Scale up by USDC_SCALE before dividing to retain 6-dp precision, then divide.
  const numerator = base * BigInt(Math.round((remainingMs / totalMs) * Number(USDC_SCALE)));
  return numerator / USDC_SCALE;
}

/**
 * Compute the proration for switching from `currentPlan` to `newPlan`.
 *
 * Credits the unused portion of the current plan and charges the prorated cost
 * of the new plan for the remaining cycle. Returns a `Result`; fails when the
 * plans use different currencies or `now` lies outside the subscription window.
 */
export function upgradeDowngrade(
  input: UpgradeDowngradeInput,
): Result<ProrationResult, SettleKitError> {
  const { currentSub, currentPlan, newPlan } = input;
  if (currentPlan.price.currency !== newPlan.price.currency) {
    return err(
      validationError("Cannot prorate across currencies", {
        from: currentPlan.price.currency,
        to: newPlan.price.currency,
      }),
    );
  }

  const start = new Date(currentSub.currentPeriodStart).getTime();
  const end = new Date(currentSub.currentPeriodEnd).getTime();
  const now = (input.now ?? new Date()).getTime();
  const totalMs = end - start;
  if (totalMs <= 0) {
    return err(validationError("Subscription period is empty or inverted"));
  }
  if (now < start || now > end) {
    return err(
      validationError("`now` is outside the current subscription period", {
        now: new Date(now).toISOString(),
        start: currentSub.currentPeriodStart,
        end: currentSub.currentPeriodEnd,
      }),
    );
  }

  const remainingMs = end - now;
  const remainingFraction = remainingMs / totalMs;
  const currency = currentPlan.price.currency;

  const unusedCreditBase = proratedBaseUnits(currentPlan.price, remainingMs, totalMs);
  const newPlanChargeBase = proratedBaseUnits(newPlan.price, remainingMs, totalMs);
  const amountDueBase = newPlanChargeBase - unusedCreditBase;

  const unusedCredit = money(fromBaseUnits(unusedCreditBase), currency);
  const newPlanCharge = money(fromBaseUnits(newPlanChargeBase), currency);
  const amountDue = money(fromBaseUnits(amountDueBase), currency);

  const priceCmp =
    toBaseUnits(newPlan.price.amount) - toBaseUnits(currentPlan.price.amount);
  const kind: ChangeKind = priceCmp > 0n ? "upgrade" : priceCmp < 0n ? "downgrade" : "no_change";

  return ok({
    kind,
    amountDue,
    unusedCredit,
    newPlanCharge,
    remainingFraction,
    newPlan,
  });
}
