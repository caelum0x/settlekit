import { generateId, type CreditBalance, type UsageMeter } from "@settlekit/common";

export function recordUsage(meter: UsageMeter, increment = 1): UsageMeter {
  if (!Number.isInteger(increment) || increment <= 0) throw new RangeError("increment must be a positive integer");
  return { ...meter, value: meter.value + increment };
}

export function createCreditBalance(input: Omit<CreditBalance, "id" | "updatedAt">, now = new Date()): CreditBalance {
  return { ...input, id: generateId("creditBalance"), updatedAt: now.toISOString() };
}

export function spendCredits(balance: CreditBalance, amount: number, now = new Date()): CreditBalance {
  if (balance.creditsRemaining < amount) throw new RangeError("insufficient credits");
  return { ...balance, creditsRemaining: balance.creditsRemaining - amount, updatedAt: now.toISOString() };
}
