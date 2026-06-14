import { generateId, type RiskProfile } from "@settlekit/common";

export function createRiskProfile(organizationId: string, flags: string[], now = new Date()): RiskProfile {
  const score = Math.min(100, flags.length * 20);
  return { id: generateId("riskProfile"), organizationId, score, flags, updatedAt: now.toISOString() };
}

export function riskAllowsCheckout(profile: RiskProfile): boolean {
  return profile.score < 80;
}
