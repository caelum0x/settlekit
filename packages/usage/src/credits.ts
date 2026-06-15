import type { CreditBalance } from "@settlekit/common";
import { generateId } from "@settlekit/common";
import { toIso } from "@settlekit/common";
import { SettleKitError, validationError } from "@settlekit/common";

/** Input required to open a fresh prepaid credit balance. */
export interface CreateBalanceInput {
  organizationId: string;
  customerId: string;
  productId: string;
  /** Optional opening grant; defaults to 0. */
  initialCredits?: number;
}

function assertNonEmpty(name: string, value: string): void {
  if (value.trim().length === 0) {
    throw validationError(`${name} must not be empty`);
  }
}

function assertCount(name: string, n: number): void {
  if (!Number.isInteger(n) || n < 0) {
    throw validationError(`${name} must be a non-negative integer`, { [name]: n });
  }
}

/** Create a new prepaid credit balance, optionally pre-granted with credits. */
export function createBalance(input: CreateBalanceInput, now: Date = new Date()): CreditBalance {
  assertNonEmpty("organizationId", input.organizationId);
  assertNonEmpty("customerId", input.customerId);
  assertNonEmpty("productId", input.productId);

  const initial = input.initialCredits ?? 0;
  assertCount("initialCredits", initial);

  return {
    id: generateId("creditBalance"),
    organizationId: input.organizationId,
    customerId: input.customerId,
    productId: input.productId,
    creditsRemaining: initial,
    creditsGranted: initial,
    updatedAt: toIso(now),
  };
}

/**
 * Grant `n` credits to a balance, returning a NEW balance. Both the remaining
 * and lifetime-granted counters advance. The original balance is not mutated.
 */
export function grantCredits(
  balance: CreditBalance,
  n: number,
  now: Date = new Date(),
): CreditBalance {
  assertCount("n", n);
  return {
    ...balance,
    creditsRemaining: balance.creditsRemaining + n,
    creditsGranted: balance.creditsGranted + n,
    updatedAt: toIso(now),
  };
}

/**
 * Consume `n` credits from a balance, returning a NEW balance with the
 * remaining counter decremented. Throws a SettleKitError with code
 * `insufficient_credits` when the balance cannot cover the request.
 */
export function consumeCredits(
  balance: CreditBalance,
  n: number,
  now: Date = new Date(),
): CreditBalance {
  assertCount("n", n);

  if (n > balance.creditsRemaining) {
    throw new SettleKitError({
      code: "insufficient_credits",
      message: "Not enough credits to complete this operation",
      details: { requested: n, remaining: balance.creditsRemaining },
    });
  }

  return {
    ...balance,
    creditsRemaining: balance.creditsRemaining - n,
    updatedAt: toIso(now),
  };
}

/** Whether the balance currently holds at least `n` credits. */
export function hasCredits(balance: CreditBalance, n: number): boolean {
  assertCount("n", n);
  return balance.creditsRemaining >= n;
}
