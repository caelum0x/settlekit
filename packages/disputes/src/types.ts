import type { IsoTimestamp } from "@settlekit/common";

/** Why a customer (or network) opened a chargeback / dispute. */
export type DisputeReason = "fraud" | "not_received" | "duplicate" | "quality" | "unrecognized";

/**
 * Dispute lifecycle. Legal transitions:
 *   open          -> under_review | won | lost | refunded
 *   under_review  -> won | lost | refunded
 *   won           -> (terminal)
 *   lost          -> (terminal)
 *   refunded      -> (terminal)
 */
export type DisputeStatus = "open" | "under_review" | "won" | "lost" | "refunded";

/** Terminal resolution outcomes. */
export type DisputeResolution = "won" | "lost" | "refunded";

/** A piece of evidence submitted to contest a dispute. */
export interface DisputeEvidence {
  id: string;
  kind: "text" | "receipt" | "shipping" | "communication" | "url" | "file";
  description: string;
  /** Free-form value: URL, file key, or inline note. */
  value: string;
  submittedAt: IsoTimestamp;
}

/** A payment dispute / chargeback case. */
export interface Dispute {
  id: string;
  paymentId: string;
  customerId: string;
  reason: DisputeReason;
  status: DisputeStatus;
  evidence: readonly DisputeEvidence[];
  openedAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  resolvedAt?: IsoTimestamp;
}
