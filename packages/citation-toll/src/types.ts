/**
 * Citation-toll domain types.
 *
 * A {@link Source} is a piece of publishable work (an article, a dataset, a
 * paragraph an agent can cite) priced for per-access settlement. Each source can
 * cite ancestor sources with a revenue share, so payment for accessing a work
 * flows recursively back through everyone it was grounded in — the "royalties
 * that follow a work through every hand that made it" idea, made economical by
 * sub-cent settlement.
 */

import type { IsoTimestamp, Money, PaymentNetwork } from "@settlekit/common";

/** A revenue share routed to an ancestor source this work is grounded in. */
export interface Citation {
  /** The ancestor source id. */
  sourceId: string;
  /** Share of THIS work's access revenue routed to that ancestor, in basis
   * points (1/100th of a percent; 0–10000). */
  shareBps: number;
}

/** A citeable, per-access-priced piece of work. */
export interface Source {
  id: string;
  organizationId: string;
  title: string;
  /** Wallet that receives this work's author share. */
  authorWallet: string;
  network: PaymentNetwork;
  /** Per-access toll, decimal USDC string (e.g. "0.0008"). */
  priceUsdc: string;
  /** The gated content served once the toll is paid. */
  body: string;
  /** Short, public, unpaid description used for discovery. */
  summary: string;
  /** Ancestors this work cites, with their revenue shares. */
  cites: readonly Citation[];
  createdAt: IsoTimestamp;
}

/** Input to create a {@link Source}. */
export interface CreateSourceInput {
  organizationId: string;
  title: string;
  authorWallet: string;
  priceUsdc: string;
  body: string;
  summary?: string;
  network?: PaymentNetwork;
  cites?: readonly Citation[];
}

/** One recipient's cut of a single access payment. */
export interface RoyaltyLeg {
  /** The source whose author this leg pays. */
  sourceId: string;
  /** The recipient wallet. */
  wallet: string;
  /** Amount routed to this wallet. */
  amount: Money;
  /** Depth in the citation graph (0 = the accessed work's own author). */
  depth: number;
}

/** The full distribution of one access payment across the citation lineage. */
export interface RoyaltyDistribution {
  /** The accessed source. */
  sourceId: string;
  /** Gross access toll paid. */
  gross: Money;
  /** Platform fee taken off the top. */
  platformFee: Money;
  /** Amount distributed to authors after the platform fee. */
  distributable: Money;
  /** Per-recipient legs (sums to `distributable`). */
  legs: readonly RoyaltyLeg[];
}
