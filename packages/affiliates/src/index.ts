import { fromBaseUnits, toBaseUnits, type Money } from "@settlekit/common";

export interface AffiliateProgram {
  id: string;
  merchantId: string;
  commissionBps: number;
  cookieDays: number;
  active: boolean;
}

export interface AffiliateAttribution {
  programId: string;
  affiliateId: string;
  customerId: string;
  attributedAt: string;
}

export function calculateAffiliateCommission(amount: Money, program: AffiliateProgram): Money {
  const commission = (toBaseUnits(amount.amount) * BigInt(program.commissionBps)) / 10_000n;
  return { amount: fromBaseUnits(commission), currency: amount.currency };
}

export function createAffiliateAttribution(programId: string, affiliateId: string, customerId: string, now = new Date()): AffiliateAttribution {
  return { programId, affiliateId, customerId, attributedAt: now.toISOString() };
}
