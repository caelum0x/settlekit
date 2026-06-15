import type { EscrowStatus, IsoTimestamp } from "@settlekit/common";

/**
 * The named transitions the escrow state machine supports. Each transition maps
 * to at most one target {@link EscrowStatus} from a given source status (see
 * `ESCROW_TRANSITIONS` in `escrow-status.ts`).
 */
export type EscrowTransition =
  | "fund"
  | "assign"
  | "submit"
  | "approve"
  | "release"
  | "refund"
  | "open_dispute"
  | "resolve_dispute_release"
  | "resolve_dispute_refund";

/** A single recorded state machine move (useful for audit trails). */
export interface EscrowStateChange {
  from: EscrowStatus;
  to: EscrowStatus;
  transition: EscrowTransition;
  at: IsoTimestamp;
}

/** Input accepted by `createTask` (plan §12). */
export interface CreateEscrowTaskInput {
  organizationId: string;
  buyerCustomerId: string;
  title: string;
  description: string;
  /** Decimal amount string in `currency` units (e.g. "100.00"). */
  amount: string;
  /** Defaults to "USDC" when omitted. */
  currency?: "USDC";
}

/** A funding event recorded when a buyer funds an escrow task. */
export interface EscrowFunding {
  taskId: string;
  /** On-chain transaction hash that delivered funds into escrow. */
  fundingTxHash: string;
  amount: string;
  currency: "USDC";
  fundedAt: IsoTimestamp;
}

/** A release event recorded when escrowed funds are released to the worker. */
export interface EscrowRelease {
  taskId: string;
  /** On-chain transaction hash that released funds to the worker. */
  releaseTxHash: string;
  /** The worker the funds were released to. */
  workerCustomerId: string;
  amount: string;
  currency: "USDC";
  releasedAt: IsoTimestamp;
}

/** A refund event recorded when escrowed funds are returned to the buyer. */
export interface EscrowRefund {
  taskId: string;
  /** Human-readable reason for the refund. */
  reason: string;
  /** The buyer the funds were returned to. */
  buyerCustomerId: string;
  amount: string;
  currency: "USDC";
  refundedAt: IsoTimestamp;
}

/** Work submitted by the assigned worker for buyer review. */
export interface TaskSubmission {
  taskId: string;
  workerCustomerId: string;
  /** Free-form description / deliverable URL / notes for the buyer. */
  content: string;
  submittedAt: IsoTimestamp;
}

/** A buyer's approval of submitted work, gating release. */
export interface TaskReview {
  taskId: string;
  reviewerCustomerId: string;
  approvedAt: IsoTimestamp;
}

/** Possible resolutions of a dispute. */
export type DisputeOutcome = "release" | "refund";

/** A dispute opened against an escrow task. */
export interface EscrowDispute {
  taskId: string;
  reason: string;
  openedAt: IsoTimestamp;
  /** Set once the dispute is resolved. */
  outcome?: DisputeOutcome;
  resolvedAt?: IsoTimestamp;
}
