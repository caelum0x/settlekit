import { generateId, toIso, type RiskProfile } from "@settlekit/common";
import type { DecisionThresholds, RiskContext, RiskDecision, Rule } from "./types.js";
import { DEFAULT_THRESHOLDS } from "./types.js";
import { defaultRules, DEFAULT_RULE_CONFIG, type RuleConfig } from "./rules.js";
import { computeScore, decide } from "./score.js";

/** Options for constructing a {@link RuleEngine}. */
export interface RuleEngineOptions {
  /** Rules to evaluate. Defaults to the built-in rule set. */
  readonly rules?: readonly Rule[];
  /** Config passed to the built-in rules (ignored when `rules` is provided). */
  readonly ruleConfig?: RuleConfig;
  /** Decision thresholds. Defaults to {@link DEFAULT_THRESHOLDS}. */
  readonly thresholds?: DecisionThresholds;
}

/** Full assessment for a transaction: the persisted profile plus the decision. */
export interface RiskAssessment {
  /** Persistable risk profile matching the shared `RiskProfile` contract. */
  readonly profile: RiskProfile;
  /** Terminal decision derived from the score. */
  readonly decision: RiskDecision;
  /** Ids of the rules that fired, in evaluation order. */
  readonly hitRuleIds: readonly string[];
}

/**
 * A pure rules engine: evaluates a fixed rule set against a {@link RiskContext}
 * to produce a {@link RiskProfile} and a {@link RiskDecision}. Construction is
 * cheap and the engine holds no mutable state, so a single instance may be
 * shared across requests.
 */
export class RuleEngine {
  private readonly rules: readonly Rule[];
  private readonly thresholds: DecisionThresholds;

  constructor(options: RuleEngineOptions = {}) {
    const config = options.ruleConfig ?? DEFAULT_RULE_CONFIG;
    this.rules = options.rules ?? defaultRules(config);
    this.thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  }

  /** The rules this engine evaluates (read-only view). */
  getRules(): readonly Rule[] {
    return this.rules;
  }

  /** The decision thresholds this engine uses. */
  getThresholds(): DecisionThresholds {
    return this.thresholds;
  }

  /**
   * Score a transaction and build a persistable {@link RiskProfile}. The
   * profile's `updatedAt` is derived from `ctx.now` so the result is fully
   * deterministic for a given context.
   */
  scoreTransaction(ctx: RiskContext): RiskProfile {
    const { score, flags } = computeScore(ctx, this.rules);
    return {
      id: generateId("riskProfile"),
      organizationId: ctx.organizationId,
      score,
      flags: [...flags],
      updatedAt: toIso(new Date(ctx.now)),
    };
  }

  /** Map a raw or profile score to a decision using this engine's thresholds. */
  decide(score: number): RiskDecision {
    return decide(score, this.thresholds);
  }

  /** Score and decide in one pass, returning both the profile and decision. */
  assess(ctx: RiskContext): RiskAssessment {
    const { score, flags, hitRuleIds } = computeScore(ctx, this.rules);
    const profile: RiskProfile = {
      id: generateId("riskProfile"),
      organizationId: ctx.organizationId,
      score,
      flags: [...flags],
      updatedAt: toIso(new Date(ctx.now)),
    };
    return {
      profile,
      decision: decide(score, this.thresholds),
      hitRuleIds: [...hitRuleIds],
    };
  }
}
