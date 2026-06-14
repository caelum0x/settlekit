import type { SaasPlan } from "./types.js";

export function createSaasPlan(plan: SaasPlan): SaasPlan {
  if (plan.seatsIncluded < 0) throw new RangeError("seatsIncluded cannot be negative");
  return plan;
}
