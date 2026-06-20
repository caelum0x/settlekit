/**
 * Attribution domain types.
 *
 * The citation toll (@settlekit/citation-toll) charges an agent that *explicitly*
 * fetches a gated source. Attribution closes the other half of the loop:
 *
 *  - **reuse detection** — given the text an agent actually produced, decide
 *    which sources it was grounded in, so the toll can be charged for *implicit*
 *    reuse, not just deliberate fetches;
 *  - **provenance lineage** — a generic weighted DAG of "this work derives from
 *    that work", so an attributed payment fans recursively through every
 *    ancestor (the citation-toll split, expressed as fractional shares that any
 *    consumer — money, credit, ranking — can use);
 *  - **proof-of-citation** — a signed, expiring token an agent presents to a
 *    seller (or an audit log) attesting that it cited and paid for a set of
 *    sources, verifiable without trusting the agent.
 *
 * Everything here is pure: no I/O, no clocks except the ones you pass in.
 */

import type { IsoTimestamp } from "@settlekit/common";

/* -------------------------------------------------------------------------- */
/* Provenance lineage                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A directed "derives-from" edge in the provenance graph: `child` attributes
 * `weight` of its value to `parent`. `weight` is a fraction in (0, 1]; the sum
 * of a child's outgoing weights must not exceed 1 (the child keeps the rest).
 */
export interface LineageEdge {
  /** The derived work. */
  child: string;
  /** The ancestor the child is grounded in. */
  parent: string;
  /** Fraction of `child`'s value routed to `parent`, in (0, 1]. */
  weight: number;
}

/** A node's fractional share of some root work's total attributed value. */
export interface AttributionShare {
  nodeId: string;
  /** Fraction of the root's value attributed here, in (0, 1]. */
  share: number;
  /** Shortest distance from the root (0 = the root itself). */
  depth: number;
}

/* -------------------------------------------------------------------------- */
/* Reuse detection                                                            */
/* -------------------------------------------------------------------------- */

/** A candidate source the detector compares generated text against. */
export interface ReuseCandidate {
  /** Source id (matches a citation-toll source / lineage node). */
  id: string;
  /** The source text the agent may have been grounded in. */
  text: string;
  /** Optional payout wallet, carried through to the match for convenience. */
  wallet?: string;
}

/** A detected grounding of generated text in one candidate source. */
export interface ReuseMatch {
  sourceId: string;
  wallet?: string;
  /**
   * Containment score in [0, 1]: the fraction of the generated text's shingles
   * that also appear in this source. 1.0 means the answer is fully covered by
   * the source.
   */
  score: number;
  /** How many of the generated text's shingles this source covers. */
  matched: number;
  /** Total shingles in the generated text (the score denominator). */
  total: number;
}

/** The result of checking generated text against a set of candidates. */
export interface ReuseReport {
  /** Stable hash of the normalized generated text (audit / dedupe key). */
  textHash: string;
  /** Total shingles extracted from the generated text. */
  total: number;
  /** Candidates that cleared the detection threshold, strongest first. */
  matches: readonly ReuseMatch[];
  /** True when at least one candidate cleared the threshold. */
  grounded: boolean;
}

/** Tunables for {@link detectReuse}. */
export interface ReuseOptions {
  /** Words per shingle. Default 4. Falls back to single words for short text. */
  shingleSize?: number;
  /** Minimum containment score to count as a match. Default 0.18. */
  threshold?: number;
  /** Minimum number of matched shingles to count as a match. Default 2. */
  minMatched?: number;
}

/* -------------------------------------------------------------------------- */
/* Proof-of-citation                                                          */
/* -------------------------------------------------------------------------- */

/** The signed claim payload — what the agent attests to. */
export interface ProofClaim {
  /** The agent / payer presenting the proof. */
  agent: string;
  /** The cited source ids (order-insensitive; canonicalized on sign). */
  sourceIds: readonly string[];
  /** The paid-access event these citations were settled under. */
  accessId: string;
  /** Total settled, decimal USDC string, if a payment backed the citation. */
  amountUsdc?: string;
  /** When the proof was issued. */
  issuedAt: IsoTimestamp;
  /** When the proof stops being valid (omitted = no expiry). */
  expiresAt?: IsoTimestamp;
  /** One-time value for replay protection. */
  nonce: string;
}

/** A signed proof-of-citation an agent presents to a seller / audit log. */
export interface CitationProof extends ProofClaim {
  /** HMAC-SHA256 of the canonical claim, hex-encoded. */
  signature: string;
}

/** Input to {@link issueCitationProof}. */
export interface IssueProofInput {
  agent: string;
  sourceIds: readonly string[];
  accessId: string;
  amountUsdc?: string;
  /** Time-to-live in seconds. Omit for a proof that never expires. */
  ttlSeconds?: number;
}
