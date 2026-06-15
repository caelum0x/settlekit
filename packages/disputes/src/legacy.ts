import { addDays, type Money } from "@settlekit/common";

/**
 * Legacy single-file dispute API, preserved for backward compatibility.
 * New code should use the engine exported from the package root (the spec
 * Dispute / DisputeService). These types are namespaced to avoid clashing
 * with the richer engine types.
 */
export type LegacyDisputeStatus = "opened" | "evidence_due" | "under_review" | "won" | "lost";

export interface LegacyDispute {
  id: string;
  paymentId: string;
  amount: Money;
  reason: "fraud" | "not_received" | "duplicate" | "quality";
  status: LegacyDisputeStatus;
  evidenceDueAt: string;
}

export function legacyOpenDispute(
  input: Omit<LegacyDispute, "status" | "evidenceDueAt">,
  now = new Date(),
): LegacyDispute {
  return { ...input, status: "opened", evidenceDueAt: addDays(now, 7).toISOString() };
}

export function submitDisputeEvidence(dispute: LegacyDispute): LegacyDispute {
  if (dispute.status === "won" || dispute.status === "lost") throw new Error("dispute already closed");
  return { ...dispute, status: "under_review" };
}
