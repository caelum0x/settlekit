/**
 * Fixed-length billing periods.
 *
 * Onchain pulls are metered against fixed-second periods anchored at the
 * subscription's first charge, because that is what the contracts enforce:
 * SpendPermissionManager resets its allowance every `period` seconds from
 * `start`, and Permit2 / SPL delegate caps are sized as price x N periods.
 * Period k covers [anchor + k*P, anchor + (k+1)*P) and is charged in advance
 * at its start (period 0 is charged on activation).
 */

export type BillingInterval = "monthly" | "yearly";

export const SECONDS_PER_DAY = 86_400;

/** 30-day months and 365-day years: stable lengths the contracts can enforce. */
export const INTERVAL_SECONDS: Readonly<Record<BillingInterval, number>> = {
  monthly: 30 * SECONDS_PER_DAY,
  yearly: 365 * SECONDS_PER_DAY,
};

export function periodSecondsFor(interval: BillingInterval): number {
  return INTERVAL_SECONDS[interval];
}

export interface PeriodBounds {
  index: number;
  start: Date;
  end: Date;
}

function assertPeriodSeconds(periodSeconds: number): void {
  if (!Number.isInteger(periodSeconds) || periodSeconds <= 0) {
    throw new RangeError(`period length must be a positive integer of seconds, got ${periodSeconds}`);
  }
}

/** Bounds of period `index` for an anchor + length. */
export function periodBounds(anchor: Date, periodSeconds: number, index: number): PeriodBounds {
  assertPeriodSeconds(periodSeconds);
  if (!Number.isInteger(index) || index < 0) throw new RangeError(`period index must be >= 0, got ${index}`);
  const startMs = anchor.getTime() + index * periodSeconds * 1000;
  return { index, start: new Date(startMs), end: new Date(startMs + periodSeconds * 1000) };
}

/** The period containing `now` (-1 before the anchor). */
export function periodIndexAt(anchor: Date, periodSeconds: number, now: Date): number {
  assertPeriodSeconds(periodSeconds);
  const elapsed = now.getTime() - anchor.getTime();
  if (elapsed < 0) return -1;
  return Math.floor(elapsed / (periodSeconds * 1000));
}

/**
 * The next period that must be charged, or null when nothing is due yet.
 * `paidThrough` is the highest period index already collected (-1 for none).
 * Only the CURRENT period is ever due: missed past periods are not
 * back-billed (the subscription lapsed through dunning instead).
 */
export function duePeriod(anchor: Date, periodSeconds: number, paidThrough: number, now: Date): number | null {
  const current = periodIndexAt(anchor, periodSeconds, now);
  if (current < 0 || current <= paidThrough) return null;
  return current;
}

/** Allowance cap for a pull grant covering `periods` periods at `amountPerPeriod`. */
export function capFor(amountPerPeriod: bigint, periods: number): bigint {
  if (amountPerPeriod <= 0n) throw new RangeError("amount per period must be positive");
  if (!Number.isInteger(periods) || periods < 1) throw new RangeError("a grant must cover at least one period");
  return amountPerPeriod * BigInt(periods);
}

/** Unix seconds for a Date (floor). */
export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/** Grant expiry: end of the last covered period plus a grace buffer. */
export function grantExpiry(anchor: Date, periodSeconds: number, periods: number, graceSeconds = 7 * SECONDS_PER_DAY): number {
  const end = periodBounds(anchor, periodSeconds, periods - 1).end;
  return toUnixSeconds(end) + graceSeconds;
}
