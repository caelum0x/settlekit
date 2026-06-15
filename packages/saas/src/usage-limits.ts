/**
 * Usage limit gating against an entitlement's numeric features (plan §20).
 *
 * SaaS plans encode quantitative caps (api_calls, projects, seats, ...) as
 * numeric features. This module decides whether a usage increment is allowed
 * given current usage and the entitlement's limit for that metric.
 */
import type { Entitlement } from "@settlekit/common";
import type { SaasPlan } from "./saas-plan.js";
import { featureLimit } from "./feature-flags.js";

/** Outcome of a usage gate check. */
export interface UsageDecision {
  allowed: boolean;
  /** Resolved limit (`Infinity` when unlimited, `undefined` when unmetered). */
  limit: number | undefined;
  /** Usage that would result if the increment were applied. */
  projected: number;
  /** Remaining headroom after the increment (`Infinity` when unlimited). */
  remaining: number;
  reason?: "no_limit" | "within_limit" | "limit_exceeded";
}

/**
 * Decide whether `increment` units of `metric` may be consumed given
 * `currentUsage`. A missing metric is treated as unmetered (allowed). A limit of
 * `Infinity` (unlimited) is always allowed.
 */
export function usageLimits(
  source: SaasPlan | Entitlement,
  metric: string,
  currentUsage: number,
  increment = 1,
): UsageDecision {
  if (!Number.isFinite(currentUsage) || currentUsage < 0) {
    throw new RangeError(`currentUsage must be a non-negative number, got ${currentUsage}`);
  }
  if (!Number.isFinite(increment) || increment < 0) {
    throw new RangeError(`increment must be a non-negative number, got ${increment}`);
  }

  const limit = featureLimit(source, metric);
  const projected = currentUsage + increment;

  if (limit === undefined) {
    return { allowed: true, limit, projected, remaining: Infinity, reason: "no_limit" };
  }
  if (limit === Infinity) {
    return { allowed: true, limit, projected, remaining: Infinity, reason: "within_limit" };
  }

  const allowed = projected <= limit;
  return {
    allowed,
    limit,
    projected,
    remaining: Math.max(0, limit - projected),
    reason: allowed ? "within_limit" : "limit_exceeded",
  };
}
