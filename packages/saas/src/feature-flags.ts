/**
 * Feature flag + limit resolution (plan §4, §20).
 *
 * Works uniformly against either a {@link SaasPlan} or an `Entitlement` whose
 * `entitlementType === "saas_feature"`. Both expose a `features` map of
 * `boolean | number` (and entitlements may carry `string` values too); this
 * module reads from whichever is supplied.
 */
import type { Entitlement } from "@settlekit/common";
import type { SaasPlan } from "./saas-plan.js";
import { UNLIMITED } from "./saas-plan.js";

/** Anything that carries a feature map can be queried for flags/limits. */
export type FeatureSource = SaasPlan | Entitlement;

function featuresOf(source: FeatureSource): Record<string, boolean | number | string> {
  return source.features ?? {};
}

/**
 * Returns true when a boolean feature flag is explicitly enabled.
 *
 * A numeric feature also counts as "enabled" when its limit is non-zero
 * (any positive limit, or `UNLIMITED`). A zero limit is treated as disabled.
 * Unknown keys are disabled.
 */
export function featureEnabled(source: FeatureSource, key: string): boolean {
  const value = featuresOf(source)[key];
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === UNLIMITED || value > 0;
  // String features are considered "set" when non-empty.
  return value.length > 0;
}

/**
 * Resolve a numeric limit for `key`.
 *
 * Returns the number when the feature is numeric, `Infinity` when it is
 * `UNLIMITED`, `0` when the feature is a disabled boolean, `Infinity` when it is
 * an enabled boolean (a flag with no quantitative cap), and `undefined` when the
 * key is absent or holds a string value.
 */
export function featureLimit(source: FeatureSource, key: string): number | undefined {
  const value = featuresOf(source)[key];
  if (value === undefined) return undefined;
  if (typeof value === "number") return value === UNLIMITED ? Infinity : value;
  if (typeof value === "boolean") return value ? Infinity : 0;
  return undefined;
}
