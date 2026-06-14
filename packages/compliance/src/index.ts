export type ComplianceDecision = "allow" | "review" | "block";

export interface ComplianceSignal {
  type: "sanctions_match" | "high_risk_country" | "velocity" | "kyb_missing" | "wallet_risk";
  severity: "low" | "medium" | "high";
}

export function decideCompliance(signals: ComplianceSignal[]): ComplianceDecision {
  if (signals.some((signal) => signal.type === "sanctions_match" || signal.severity === "high")) return "block";
  if (signals.some((signal) => signal.severity === "medium")) return "review";
  return "allow";
}

export function kybComplete(fields: { legalName?: string; country?: string; taxId?: string }): boolean {
  return Boolean(fields.legalName && fields.country && fields.taxId);
}
