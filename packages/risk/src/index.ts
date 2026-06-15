export type {
  ActivityEvent,
  RiskContext,
  RuleResult,
  Rule,
  RiskDecision,
  DecisionThresholds,
} from "./types.js";
export { DEFAULT_THRESHOLDS } from "./types.js";

export type { RuleConfig } from "./rules.js";
export {
  DEFAULT_RULE_CONFIG,
  highVelocityRule,
  newAccountLargeAmountRule,
  refundAbuseRule,
  mismatchedGeoWalletReuseRule,
  chargebackHistoryRule,
  defaultRules,
} from "./rules.js";

export type { ScoreResult } from "./score.js";
export { clampScore, computeScore, decide } from "./score.js";

export type { RuleEngineOptions, RiskAssessment } from "./engine.js";
export { RuleEngine } from "./engine.js";
