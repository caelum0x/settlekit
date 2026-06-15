import { compareMoney, type Money } from "@settlekit/common";
import type { ActivityEvent, RiskContext, Rule, RuleResult } from "./types.js";

const HIT_FALSE: RuleResult = { hit: false };

/** Count events that fall within `windowMs` before `now` (inclusive). */
function countWithinWindow(
  events: readonly ActivityEvent[] | undefined,
  now: number,
  windowMs: number,
): number {
  if (events === undefined || events.length === 0) return 0;
  const cutoff = now - windowMs;
  let count = 0;
  for (const event of events) {
    if (event.at >= cutoff && event.at <= now) count += 1;
  }
  return count;
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

/** Configuration knobs for the built-in rules. All fields have defaults. */
export interface RuleConfig {
  /** Max checkouts allowed within {@link RuleConfig.velocityWindowMs}. */
  readonly maxCheckoutsPerWindow: number;
  /** Max payments allowed within {@link RuleConfig.velocityWindowMs}. */
  readonly maxPaymentsPerWindow: number;
  /** Sliding window for velocity checks, in milliseconds. */
  readonly velocityWindowMs: number;

  /** An account younger than this (ms) counts as "new". */
  readonly newAccountMaxAgeMs: number;
  /** Amount at/above which a new account is considered risky. */
  readonly newAccountLargeAmount: Money;

  /** Max refunds within {@link RuleConfig.refundWindowMs} before flagging. */
  readonly maxRefundsPerWindow: number;
  /** Sliding window for refund-abuse detection, in milliseconds. */
  readonly refundWindowMs: number;

  /** Chargeback count at/above which the customer is flagged. */
  readonly chargebackThreshold: number;

  /** Distinct other customers sharing a wallet at/above which to flag reuse. */
  readonly walletReuseThreshold: number;
}

/** Sensible production defaults for {@link RuleConfig}. */
export const DEFAULT_RULE_CONFIG: RuleConfig = {
  maxCheckoutsPerWindow: 5,
  maxPaymentsPerWindow: 4,
  velocityWindowMs: ONE_HOUR_MS,
  newAccountMaxAgeMs: ONE_DAY_MS,
  newAccountLargeAmount: { amount: "500", currency: "USDC" },
  maxRefundsPerWindow: 3,
  refundWindowMs: 30 * ONE_DAY_MS,
  chargebackThreshold: 1,
  walletReuseThreshold: 3,
};

/** Too many checkouts or payments in the velocity window. */
export function highVelocityRule(config: RuleConfig = DEFAULT_RULE_CONFIG): Rule {
  return {
    id: "high_velocity",
    weight: 25,
    evaluate(ctx: RiskContext): RuleResult {
      const checkouts = countWithinWindow(ctx.recentCheckouts, ctx.now, config.velocityWindowMs);
      const payments = countWithinWindow(ctx.recentPayments, ctx.now, config.velocityWindowMs);
      const checkoutsTooHigh = checkouts > config.maxCheckoutsPerWindow;
      const paymentsTooHigh = payments > config.maxPaymentsPerWindow;
      if (!checkoutsTooHigh && !paymentsTooHigh) return HIT_FALSE;
      const parts: string[] = [];
      if (checkoutsTooHigh) {
        parts.push(`${checkouts} checkouts (limit ${config.maxCheckoutsPerWindow})`);
      }
      if (paymentsTooHigh) {
        parts.push(`${payments} payments (limit ${config.maxPaymentsPerWindow})`);
      }
      return { hit: true, reason: `High velocity: ${parts.join(", ")} in window` };
    },
  };
}

/** A brand-new account attempting an unusually large transaction. */
export function newAccountLargeAmountRule(config: RuleConfig = DEFAULT_RULE_CONFIG): Rule {
  return {
    id: "new_account_large_amount",
    weight: 30,
    evaluate(ctx: RiskContext): RuleResult {
      if (ctx.accountCreatedAt === undefined) return HIT_FALSE;
      const ageMs = ctx.now - ctx.accountCreatedAt;
      if (ageMs < 0 || ageMs > config.newAccountMaxAgeMs) return HIT_FALSE;
      // Only compare same-currency amounts; mismatches are out of scope here.
      if (ctx.amount.currency !== config.newAccountLargeAmount.currency) return HIT_FALSE;
      if (compareMoney(ctx.amount, config.newAccountLargeAmount) < 0) return HIT_FALSE;
      return {
        hit: true,
        reason: `New account (age ${Math.floor(ageMs / ONE_HOUR_MS)}h) with large amount ${ctx.amount.amount} ${ctx.amount.currency}`,
      };
    },
  };
}

/** Excessive refunds in the refund window — a classic abuse signal. */
export function refundAbuseRule(config: RuleConfig = DEFAULT_RULE_CONFIG): Rule {
  return {
    id: "refund_abuse",
    weight: 20,
    evaluate(ctx: RiskContext): RuleResult {
      const refunds = countWithinWindow(ctx.recentRefunds, ctx.now, config.refundWindowMs);
      if (refunds <= config.maxRefundsPerWindow) return HIT_FALSE;
      return {
        hit: true,
        reason: `Refund abuse: ${refunds} refunds (limit ${config.maxRefundsPerWindow}) in window`,
      };
    },
  };
}

/**
 * Billing country and IP geolocation disagree, and/or the paying wallet is
 * shared across many distinct customers (account-farming / reuse signal).
 */
export function mismatchedGeoWalletReuseRule(config: RuleConfig = DEFAULT_RULE_CONFIG): Rule {
  return {
    id: "mismatched_geo_wallet_reuse",
    weight: 15,
    evaluate(ctx: RiskContext): RuleResult {
      const geoMismatch =
        ctx.billingCountry !== undefined &&
        ctx.ipCountry !== undefined &&
        ctx.billingCountry.toUpperCase() !== ctx.ipCountry.toUpperCase();
      const walletReuse =
        ctx.walletDistinctCustomerCount !== undefined &&
        ctx.walletDistinctCustomerCount >= config.walletReuseThreshold;
      if (!geoMismatch && !walletReuse) return HIT_FALSE;
      const parts: string[] = [];
      if (geoMismatch) {
        parts.push(`geo mismatch (billing ${ctx.billingCountry}, ip ${ctx.ipCountry})`);
      }
      if (walletReuse) {
        parts.push(`wallet reused by ${ctx.walletDistinctCustomerCount} customers`);
      }
      return { hit: true, reason: parts.join("; ") };
    },
  };
}

/** Prior chargebacks/disputes against this customer. */
export function chargebackHistoryRule(config: RuleConfig = DEFAULT_RULE_CONFIG): Rule {
  return {
    id: "chargeback_history",
    weight: 35,
    evaluate(ctx: RiskContext): RuleResult {
      const count = ctx.chargebackCount ?? 0;
      if (count < config.chargebackThreshold) return HIT_FALSE;
      return {
        hit: true,
        reason: `Chargeback history: ${count} prior chargeback(s)`,
      };
    },
  };
}

/** The full set of built-in rules, in evaluation order. */
export function defaultRules(config: RuleConfig = DEFAULT_RULE_CONFIG): readonly Rule[] {
  return [
    highVelocityRule(config),
    newAccountLargeAmountRule(config),
    refundAbuseRule(config),
    mismatchedGeoWalletReuseRule(config),
    chargebackHistoryRule(config),
  ];
}
