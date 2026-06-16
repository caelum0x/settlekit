/**
 * Disputes resource client.
 *
 * Maps to `/v1/disputes`. A dispute is opened against a confirmed payment,
 * evidence is submitted while it is `open`/`under_review`, and it is resolved
 * with an outcome (`won` / `lost` / `refunded`).
 */
import type { HttpClient, RequestOptions } from "../http-client.js";

/** Why a dispute was opened. */
export type DisputeReason = "fraud" | "not_received" | "duplicate" | "quality" | "unrecognized";

/** Lifecycle of a dispute. */
export type DisputeStatus = "open" | "under_review" | "won" | "lost" | "refunded";

/** The kind of evidence attached to a dispute. */
export type DisputeEvidenceKind =
  | "text"
  | "receipt"
  | "shipping"
  | "communication"
  | "url"
  | "file";

/** A single piece of evidence submitted for a dispute. */
export interface DisputeEvidence {
  id: string;
  kind: DisputeEvidenceKind;
  description: string;
  value: string;
  submittedAt: string;
}

/** A dispute against a confirmed payment, as returned by the API. */
export interface Dispute {
  id: string;
  paymentId: string;
  customerId: string;
  reason: DisputeReason;
  status: DisputeStatus;
  evidence: DisputeEvidence[];
  openedAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

/** Input for {@link DisputesResource.open}. */
export interface OpenDisputeInput {
  paymentId: string;
  customerId: string;
  reason: DisputeReason;
}

/** Input for {@link DisputesResource.submitEvidence}. */
export interface SubmitEvidenceInput {
  kind: DisputeEvidenceKind;
  description: string;
  value: string;
}

/** Resolution outcome for a dispute. */
export type DisputeOutcome = "won" | "lost" | "refunded";

/** Client for dispute endpoints. */
export class DisputesResource {
  constructor(private readonly http: HttpClient) {}

  /** List disputes, optionally filtered by status. */
  list(status?: DisputeStatus, options?: RequestOptions): Promise<Dispute[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.http.get<Dispute[]>(`/v1/disputes${qs}`, options);
  }

  /** Open a dispute against a payment. */
  open(input: OpenDisputeInput, options?: RequestOptions): Promise<Dispute> {
    return this.http.post<Dispute>("/v1/disputes", input, options);
  }

  /** Retrieve a dispute by id. */
  retrieve(id: string, options?: RequestOptions): Promise<Dispute> {
    return this.http.get<Dispute>(`/v1/disputes/${encodeURIComponent(id)}`, options);
  }

  /** Submit a piece of evidence for a dispute. */
  submitEvidence(id: string, input: SubmitEvidenceInput, options?: RequestOptions): Promise<Dispute> {
    return this.http.post<Dispute>(
      `/v1/disputes/${encodeURIComponent(id)}/evidence`,
      input,
      options,
    );
  }

  /** Resolve a dispute with an outcome. */
  resolve(id: string, outcome: DisputeOutcome, options?: RequestOptions): Promise<Dispute> {
    return this.http.post<Dispute>(
      `/v1/disputes/${encodeURIComponent(id)}/resolve`,
      { outcome },
      options,
    );
  }
}
