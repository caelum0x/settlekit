import type { Result, SettleKitError } from "@settlekit/common";
import { conflict, err, ok, toIso, validationError } from "@settlekit/common";
import type {
  Dispute,
  DisputeEvidence,
  DisputeReason,
  DisputeResolution,
  DisputeStatus,
} from "./types.js";

/** Statuses from which no further transition is allowed. */
const TERMINAL: ReadonlySet<DisputeStatus> = new Set<DisputeStatus>(["won", "lost", "refunded"]);

/** Legal status transitions. */
const TRANSITIONS: Readonly<Record<DisputeStatus, ReadonlySet<DisputeStatus>>> = {
  open: new Set<DisputeStatus>(["under_review", "won", "lost", "refunded"]),
  under_review: new Set<DisputeStatus>(["won", "lost", "refunded"]),
  won: new Set<DisputeStatus>(),
  lost: new Set<DisputeStatus>(),
  refunded: new Set<DisputeStatus>(),
};

/** True when `to` is a legal next status from `from`. */
export function canTransition(from: DisputeStatus, to: DisputeStatus): boolean {
  return TRANSITIONS[from].has(to);
}

/** True when a dispute can no longer change state. */
export function isResolved(dispute: Dispute): boolean {
  return TERMINAL.has(dispute.status);
}

/** Input required to open a dispute. */
export interface OpenDisputeInput {
  paymentId: string;
  customerId: string;
  reason: DisputeReason;
}

/** Open a new dispute in the `open` state with no evidence. */
export function openDispute(
  input: OpenDisputeInput,
  generate: () => string,
  now: Date = new Date(),
): Result<Dispute, SettleKitError> {
  if (input.paymentId.length === 0) return err(validationError("paymentId is required"));
  if (input.customerId.length === 0) return err(validationError("customerId is required"));

  const timestamp = toIso(now);
  const dispute: Dispute = {
    id: generate(),
    paymentId: input.paymentId,
    customerId: input.customerId,
    reason: input.reason,
    status: "open",
    evidence: [],
    openedAt: timestamp,
    updatedAt: timestamp,
  };
  return ok(dispute);
}

/** Input describing a single evidence item to attach. */
export interface SubmitEvidenceInput {
  kind: DisputeEvidence["kind"];
  description: string;
  value: string;
}

/**
 * Attach evidence and move the dispute to `under_review`. Evidence cannot be
 * submitted once a dispute is resolved.
 */
export function submitEvidence(
  dispute: Dispute,
  input: SubmitEvidenceInput,
  generate: () => string,
  now: Date = new Date(),
): Result<Dispute, SettleKitError> {
  if (isResolved(dispute)) {
    return err(conflict(`cannot submit evidence on a ${dispute.status} dispute`, { disputeId: dispute.id }));
  }
  if (input.description.length === 0 || input.value.length === 0) {
    return err(validationError("evidence requires a description and value", { disputeId: dispute.id }));
  }

  const timestamp = toIso(now);
  const evidence: DisputeEvidence = {
    id: generate(),
    kind: input.kind,
    description: input.description,
    value: input.value,
    submittedAt: timestamp,
  };
  const nextStatus: DisputeStatus = dispute.status === "open" ? "under_review" : dispute.status;
  return ok({
    ...dispute,
    status: nextStatus,
    evidence: [...dispute.evidence, evidence],
    updatedAt: timestamp,
  });
}

/**
 * Resolve a dispute with a terminal outcome (won/lost/refunded). Rejects
 * transitions that are not legal from the current status with a conflict.
 */
export function resolve(
  dispute: Dispute,
  outcome: DisputeResolution,
  now: Date = new Date(),
): Result<Dispute, SettleKitError> {
  if (!canTransition(dispute.status, outcome)) {
    return err(
      conflict(`illegal dispute transition ${dispute.status} -> ${outcome}`, {
        disputeId: dispute.id,
        from: dispute.status,
        to: outcome,
      }),
    );
  }
  const timestamp = toIso(now);
  return ok({ ...dispute, status: outcome, resolvedAt: timestamp, updatedAt: timestamp });
}
