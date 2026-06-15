import type { Money } from "@settlekit/common";

/**
 * A timestamped event that contributed by a customer/account in the recent
 * past. The rules engine inspects collections of these to detect velocity and
 * abuse patterns. All timestamps are epoch milliseconds (UTC).
 */
export interface ActivityEvent {
  /** Epoch milliseconds when the event occurred. */
  readonly at: number;
  /** Monetary amount associated with the event, if any (e.g. payment value). */
  readonly amount?: Money;
}

/**
 * Snapshot of a customer's history used to evaluate risk. Every field is
 * optional-with-default semantics: a missing list is treated as empty, a
 * missing count as zero. Callers assemble this from their own data stores.
 */
export interface RiskContext {
  /** Organization the transaction belongs to (propagated onto the profile). */
  readonly organizationId: string;
  /** Customer / account identifier the transaction belongs to. */
  readonly customerId: string;
  /** Wall-clock time the transaction is being evaluated (epoch millis). */
  readonly now: number;

  /** The amount of the transaction currently being evaluated. */
  readonly amount: Money;

  /** When the account was created (epoch millis). */
  readonly accountCreatedAt?: number;

  /** Recent checkout-session creation events (most-recent ordering not required). */
  readonly recentCheckouts?: readonly ActivityEvent[];
  /** Recent successful payment events. */
  readonly recentPayments?: readonly ActivityEvent[];
  /** Recent refund events issued to this customer. */
  readonly recentRefunds?: readonly ActivityEvent[];

  /** Lifetime count of chargebacks/disputes filed against this customer. */
  readonly chargebackCount?: number;

  /** ISO 3166-1 alpha-2 country derived from the customer's billing record. */
  readonly billingCountry?: string;
  /** ISO 3166-1 alpha-2 country derived from the request IP geolocation. */
  readonly ipCountry?: string;

  /** Wallet address used to pay. */
  readonly walletAddress?: string;
  /** Number of distinct other customers that have used the same wallet address. */
  readonly walletDistinctCustomerCount?: number;
}

/** Outcome of evaluating a single rule against a context. */
export interface RuleResult {
  /** Whether the rule's condition matched (i.e. contributes to the score). */
  readonly hit: boolean;
  /** Human-readable explanation, present when {@link RuleResult.hit} is true. */
  readonly reason?: string;
}

/**
 * A pure, deterministic risk rule. Implementations MUST NOT mutate the context
 * and MUST NOT perform IO; given identical input they return identical output.
 */
export interface Rule {
  /** Stable identifier, used for flags and deduplication. */
  readonly id: string;
  /**
   * Relative contribution to the total score when the rule hits. Weights are
   * summed across hitting rules and the result is clamped to 0..100.
   */
  readonly weight: number;
  /** Evaluate the rule. Pure: no side effects, no IO. */
  evaluate(ctx: RiskContext): RuleResult;
}

/** Terminal decision derived from a score via threshold bands. */
export type RiskDecision = "allow" | "review" | "block";

/** Inclusive lower bounds (exclusive upper) that map a score to a decision. */
export interface DecisionThresholds {
  /** Scores `>= review` (and `< block`) require manual review. */
  readonly review: number;
  /** Scores `>= block` are blocked. */
  readonly block: number;
}

/** Default thresholds: <40 allow, 40..69 review, >=70 block. */
export const DEFAULT_THRESHOLDS: DecisionThresholds = {
  review: 40,
  block: 70,
};
