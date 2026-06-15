import type { DecisionThresholds, RiskContext, RiskDecision, Rule } from "./types.js";
import { DEFAULT_THRESHOLDS } from "./types.js";

/** Clamp a number into the inclusive 0..100 range, rounding to an integer. */
export function clampScore(value: number): number {
  if (Number.isNaN(value)) return 0;
  const rounded = Math.round(value);
  if (rounded < 0) return 0;
  if (rounded > 100) return 100;
  return rounded;
}

/** Result of running a rule set: the clamped score plus the flags that fired. */
export interface ScoreResult {
  /** Weighted sum of hitting rules, clamped to 0..100. */
  readonly score: number;
  /** Reasons emitted by rules that hit (rule id used when no reason given). */
  readonly flags: readonly string[];
  /** Ids of the rules that hit, in evaluation order. */
  readonly hitRuleIds: readonly string[];
}

/**
 * Run every rule against the context and aggregate. The raw weighted sum is
 * clamped to 0..100. Pure and deterministic for a fixed rule set + context.
 */
export function computeScore(ctx: RiskContext, rules: readonly Rule[]): ScoreResult {
  let total = 0;
  const flags: string[] = [];
  const hitRuleIds: string[] = [];
  for (const rule of rules) {
    const result = rule.evaluate(ctx);
    if (!result.hit) continue;
    total += rule.weight;
    hitRuleIds.push(rule.id);
    flags.push(result.reason ?? rule.id);
  }
  return { score: clampScore(total), flags, hitRuleIds };
}

/** Map a score to a terminal decision via threshold bands. */
export function decide(
  score: number,
  thresholds: DecisionThresholds = DEFAULT_THRESHOLDS,
): RiskDecision {
  const clamped = clampScore(score);
  if (clamped >= thresholds.block) return "block";
  if (clamped >= thresholds.review) return "review";
  return "allow";
}
