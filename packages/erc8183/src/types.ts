/**
 * SettleKit-facing types for the ERC-8183 autonomous-agent job lifecycle on Arc.
 *
 * ERC-8183 models a unit of agent work as an on-chain *job*: a requester posts a
 * spec and funds a USDC escrow, a worker submits a deliverable, an evaluator
 * scores it, and the escrow either settles to the worker or refunds the
 * requester. This package wraps that lifecycle in SettleKit idioms —
 * decimal-USDC amounts ({@link Money}), schema-validated requests, a `Result`
 * surface that never throws across the boundary, and an explicit state machine.
 *
 * The on-chain operations are injected through an {@link Erc8183Port} (dependency
 * inversion) so this package never imports a chain SDK and adds no external
 * dependency — the consumer supplies a viem + Circle DCW backed implementation,
 * and tests/demos use the deterministic local port.
 */

import { type Money, conflict } from "@settlekit/common";

/** Lifecycle state of a job. */
export type JobStatus =
  | "created"
  | "funded"
  | "submitted"
  | "evaluated"
  | "settled"
  | "refunded"
  | "cancelled";

/** A move between job statuses. */
export type JobTransition =
  | "fund"
  | "submit"
  | "evaluate_pass"
  | "evaluate_fail"
  | "settle"
  | "refund"
  | "cancel";

/** The evaluator's verdict on a submitted deliverable. */
export interface JobEvaluation {
  /** Whether the deliverable passed evaluation. */
  passed: boolean;
  /** An optional numeric score string or a URI to a detailed rubric. */
  scoreOrUri?: string;
}

/** A job in the ERC-8183 lifecycle. */
export interface Job {
  /** On-chain job identifier (port-minted). */
  id: string;
  /** Address of the party requesting and funding the work. */
  requester: string;
  /** Address of the agent performing the work. */
  worker: string;
  /** Escrowed USDC amount. */
  amount: Money;
  /** Current lifecycle status. */
  status: JobStatus;
  /** URI of the submitted deliverable, once present. */
  deliverableUri?: string;
  /** Evaluation verdict, once present. */
  evaluation?: JobEvaluation;
}

/**
 * The legal transition table for the job lifecycle.
 *
 * Read as: from `source` status, applying `transition` yields the target
 * status. Any (source, transition) pair not present here is illegal and is
 * rejected by {@link assertTransition} with a `conflict` (HTTP 409) error.
 *
 * Lifecycle (happy path):
 *   created -> funded -> submitted -> evaluated -> settled
 *
 * Branches:
 *   - a created or funded job may be cancelled before work begins.
 *   - a refund is permitted from funded/submitted/evaluated (escrow returns to
 *     the requester).
 *   - evaluate maps BOTH a pass and a fail to the single `evaluated` status; the
 *     "cannot settle a failed evaluation" rule is therefore enforced by the port
 *     (see LocalErc8183Port.settle), not expressible by this table alone.
 *
 * Terminal states (settled, refunded, cancelled) have no outgoing transitions.
 */
export const JOB_TRANSITIONS: Readonly<
  Record<JobStatus, Readonly<Partial<Record<JobTransition, JobStatus>>>>
> = {
  created: {
    fund: "funded",
    cancel: "cancelled",
  },
  funded: {
    submit: "submitted",
    refund: "refunded",
    cancel: "cancelled",
  },
  submitted: {
    evaluate_pass: "evaluated",
    evaluate_fail: "evaluated",
    refund: "refunded",
  },
  evaluated: {
    settle: "settled",
    refund: "refunded",
  },
  settled: {},
  refunded: {},
  cancelled: {},
};

/** Return the target status for a transition, or `undefined` if illegal. */
export function peekTransition(
  status: JobStatus,
  transition: JobTransition,
): JobStatus | undefined {
  return JOB_TRANSITIONS[status][transition];
}

/** Whether `transition` is legal from the given `status`. */
export function canTransition(status: JobStatus, transition: JobTransition): boolean {
  return peekTransition(status, transition) !== undefined;
}

/**
 * Guard the job state machine: resolve the target status for a transition or
 * throw a `conflict` {@link import("@settlekit/common").SettleKitError} (HTTP
 * 409) describing the illegal move. This is the single enforcement point every
 * transition funnels through.
 */
export function assertTransition(status: JobStatus, transition: JobTransition): JobStatus {
  const next = peekTransition(status, transition);
  if (next === undefined) {
    throw conflict(`Illegal job transition "${transition}" from status "${status}".`, {
      from: status,
      transition,
    });
  }
  return next;
}

/** Whether a status is terminal (no further transitions are possible). */
export function isTerminalJobStatus(status: JobStatus): boolean {
  return Object.keys(JOB_TRANSITIONS[status]).length === 0;
}

/* -------------------------------------------------------------------------- */
/* Request / result shapes                                                     */
/* -------------------------------------------------------------------------- */

/** Create a new job and post its spec. */
export interface CreateJobRequest {
  /** Address of the requester funding the work. */
  requester: string;
  /** Address of the worker that will perform the job. */
  worker: string;
  /** Decimal USDC amount to escrow, e.g. "100.00". */
  amountUsdc: string;
  /** URI of the job specification (e.g. ipfs://...). */
  specUri: string;
}

/** Fund the USDC escrow for an existing job. */
export interface FundEscrowRequest {
  jobId: string;
  /** Decimal USDC amount to fund. */
  amountUsdc: string;
}

/** Submit a deliverable for a funded job. */
export interface SubmitDeliverableRequest {
  jobId: string;
  /** URI of the submitted deliverable. */
  deliverableUri: string;
}

/** Record an evaluation verdict for a submitted job. */
export interface EvaluateRequest {
  jobId: string;
  /** Whether the deliverable passed. */
  passed: boolean;
  /** Optional numeric score string or a URI to a detailed rubric. */
  scoreOrUri?: string;
}

/** Address a single job by its id (settle/refund/getJob). */
export interface JobIdRequest {
  jobId: string;
}

/** Result of creating a job. */
export interface CreateJobResult {
  /** On-chain job identifier. */
  jobId: string;
  /** On-chain transaction hash. */
  txHash: string;
}

/** Normalized result of an on-chain job operation. */
export interface TxResult {
  /** On-chain transaction hash. */
  txHash: string;
  /** Status of the transaction. */
  status: "success" | "pending" | "failed";
}
