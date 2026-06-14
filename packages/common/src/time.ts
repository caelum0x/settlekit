/** Time helpers. All timestamps in SettleKit are ISO-8601 strings (UTC). */

export type IsoTimestamp = string;

export function toIso(date: Date): IsoTimestamp {
  return date.toISOString();
}

export function addDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export function addYears(from: Date, years: number): Date {
  const d = new Date(from.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

export function isPast(timestamp: IsoTimestamp, now: Date = new Date()): boolean {
  return new Date(timestamp).getTime() < now.getTime();
}

/** Period end for a subscription interval starting at `start`. */
export function periodEnd(start: Date, interval: "monthly" | "yearly"): Date {
  return interval === "monthly" ? addMonths(start, 1) : addYears(start, 1);
}
