/**
 * Actions the operator can propose. Every proposal carries the reasoning the
 * decision log records: rationale, alternatives considered and confidence,
 * plus the policy verdict it was checked against.
 */
import type { PolicyVerdict } from "./policy.js";
import type { Bucket, BucketBalances } from "./types.js";

export type ProposedAction =
  | { readonly kind: "allocate"; readonly amounts: BucketBalances }
  | {
      readonly kind: "payout";
      readonly bucket: Bucket;
      readonly to: string;
      readonly amount: bigint;
      readonly ref: string;
    }
  | { readonly kind: "refund"; readonly to: string; readonly amount: bigint; readonly ref: string }
  | { readonly kind: "sweep_to_yield"; readonly amount: bigint }
  | { readonly kind: "redeem_from_yield"; readonly amount: bigint }
  | { readonly kind: "escalate"; readonly reason: string; readonly subject?: ProposedAction }
  | { readonly kind: "decline"; readonly reason: string }
  | { readonly kind: "defer"; readonly reason: string };

export type ActionKind = ProposedAction["kind"];

export interface Proposal {
  readonly action: ProposedAction;
  readonly rationale: string;
  readonly alternativesConsidered: readonly string[];
  /** 0..1 */
  readonly confidence: number;
  readonly verdict: PolicyVerdict | null;
}

/** Build a frozen proposal, clamping confidence into [0, 1]. */
export function proposal(
  action: ProposedAction,
  rationale: string,
  alternativesConsidered: readonly string[],
  confidence: number,
  verdict: PolicyVerdict | null = null,
): Proposal {
  const clamped = Math.min(1, Math.max(0, confidence));
  return Object.freeze({ action, rationale, alternativesConsidered: [...alternativesConsidered], confidence: clamped, verdict });
}
