import { addMoney, subtractMoney, type Money } from "@settlekit/common";

export interface BillingCreditGrant {
  customerId: string;
  amount: Money;
  reason: "promotion" | "refund_credit" | "service_credit" | "manual";
  createdAt: string;
}

export function grantBillingCredit(input: Omit<BillingCreditGrant, "createdAt">, now = new Date()): BillingCreditGrant {
  return { ...input, createdAt: now.toISOString() };
}

export function totalBillingCredits(grants: BillingCreditGrant[]): Money {
  return grants.reduce((sum, grant) => addMoney(sum, grant.amount), { amount: "0", currency: "USDC" });
}

export function applyBillingCredit(total: Money, credits: Money): Money {
  return subtractMoney(total, credits).amount.startsWith("-") ? { amount: "0", currency: total.currency } : subtractMoney(total, credits);
}
