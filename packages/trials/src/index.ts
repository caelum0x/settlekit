import { addDays, isPast } from "@settlekit/common";

export interface Trial {
  customerId: string;
  productId: string;
  startedAt: string;
  endsAt: string;
  convertedAt?: string;
}

export function createTrial(customerId: string, productId: string, days: number, now = new Date()): Trial {
  if (!Number.isInteger(days) || days <= 0) throw new RangeError("trial days must be a positive integer");
  return { customerId, productId, startedAt: now.toISOString(), endsAt: addDays(now, days).toISOString() };
}

export function trialIsActive(trial: Trial, now = new Date()): boolean {
  return trial.convertedAt === undefined && !isPast(trial.endsAt, now);
}

export function convertTrial(trial: Trial, now = new Date()): Trial {
  return { ...trial, convertedAt: now.toISOString() };
}
