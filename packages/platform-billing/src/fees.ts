import type { Money, Payment } from "@settlekit/common";
import {
  addMoney,
  fromBaseUnits,
  money,
  subtractMoney,
  toBaseUnits,
} from "@settlekit/common";
import type { PlatformFeeSchedule, PlatformRevenue } from "./types.js";

/** SettleKit's default take-rate: 2.5% + $0.30 per payment. */
export const DEFAULT_FEE_SCHEDULE: PlatformFeeSchedule = { bps: 250, fixed: "0.30" };

const BPS_DENOMINATOR = 10_000n;

/**
 * Validate and normalize a fee schedule. `bps` must be an integer in
 * [0, 10000] (0%–100%) and `fixed` a non-negative decimal amount; invalid
 * input throws so a misconfigured platform fee fails fast at startup rather
 * than silently skimming the wrong amount.
 */
export function normalizeSchedule(schedule: PlatformFeeSchedule): PlatformFeeSchedule {
  const { bps, fixed } = schedule;
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new Error(`platform fee bps must be an integer in [0, 10000], got ${bps}`);
  }
  // toBaseUnits throws on a malformed decimal; reject negatives explicitly.
  if (toBaseUnits(fixed) < 0n) {
    throw new Error(`platform fee fixed must be non-negative, got ${fixed}`);
  }
  return { bps, fixed };
}

/**
 * The platform fee for a single payment: `gross * bps / 10000` (floored) plus
 * the fixed per-payment fee, never exceeding the payment itself. Pure bigint
 * base-unit math, so there is no floating-point drift.
 */
export function applicationFee(amount: Money, schedule: PlatformFeeSchedule): Money {
  const { bps, fixed } = normalizeSchedule(schedule);
  const grossBase = toBaseUnits(amount.amount);
  const variable = (grossBase * BigInt(bps)) / BPS_DENOMINATOR;
  const feeBase = variable + toBaseUnits(fixed);
  const capped = feeBase > grossBase ? grossBase : feeBase;
  return money(fromBaseUnits(capped), amount.currency);
}

/** Confirmed payments only — the fee accrues when money actually settled. */
function confirmed(payments: readonly Payment[]): readonly Payment[] {
  return payments.filter((p) => p.status === "confirmed");
}

/** Sum the platform fee across all confirmed payments. */
export function totalPlatformFees(
  payments: readonly Payment[],
  schedule: PlatformFeeSchedule,
  currency: Money["currency"] = "USDC",
): Money {
  return confirmed(payments).reduce(
    (sum, p) => addMoney(sum, applicationFee(p.amount, schedule)),
    money("0", currency),
  );
}

/**
 * Full settlement economics for a merchant over a set of payments: gross,
 * platform fees, and the net withdrawable to the merchant.
 */
export function computePlatformRevenue(
  payments: readonly Payment[],
  schedule: PlatformFeeSchedule,
  currency: Money["currency"] = "USDC",
): PlatformRevenue {
  const settled = confirmed(payments);
  const grossVolume = settled.reduce((sum, p) => addMoney(sum, p.amount), money("0", currency));
  const platformFees = totalPlatformFees(settled, schedule, currency);
  return {
    grossVolume,
    platformFees,
    netToMerchant: subtractMoney(grossVolume, platformFees),
    paymentCount: settled.length,
    schedule: normalizeSchedule(schedule),
  };
}
