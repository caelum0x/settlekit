import { addDays } from "@settlekit/common";

export function gracePeriodEnd(from: Date, graceDays: number): string {
  if (!Number.isInteger(graceDays) || graceDays < 0) throw new RangeError("graceDays must be a non-negative integer");
  return addDays(from, graceDays).toISOString();
}
