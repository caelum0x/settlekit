import { addDays, type Money } from "@settlekit/common";

export type DisputeStatus = "opened" | "evidence_due" | "under_review" | "won" | "lost";

export interface Dispute {
  id: string;
  paymentId: string;
  amount: Money;
  reason: "fraud" | "not_received" | "duplicate" | "quality";
  status: DisputeStatus;
  evidenceDueAt: string;
}

export function openDispute(input: Omit<Dispute, "status" | "evidenceDueAt">, now = new Date()): Dispute {
  return { ...input, status: "opened", evidenceDueAt: addDays(now, 7).toISOString() };
}

export function submitDisputeEvidence(dispute: Dispute): Dispute {
  if (dispute.status === "won" || dispute.status === "lost") throw new Error("dispute already closed");
  return { ...dispute, status: "under_review" };
}
