import type { Money, Payment, Result, SettleKitError } from "@settlekit/common";
import {
  addMoney,
  compareMoney,
  conflict,
  err,
  money,
  ok,
  subtractMoney,
  toIso,
  validationError,
} from "@settlekit/common";
import type { Payout, PayoutNetwork } from "./types.js";

/** Sum the gross amount of confirmed payments. */
export function grossConfirmed(payments: readonly Payment[], currency: Money["currency"] = "USDC"): Money {
  return payments
    .filter((p) => p.status === "confirmed")
    .reduce((sum, p) => addMoney(sum, p.amount), money("0", currency));
}

/** Sum prior payouts that hold value (pending or paid; failed are excluded). */
export function reservedByPayouts(payouts: readonly Payout[], currency: Money["currency"] = "USDC"): Money {
  return payouts
    .filter((p) => p.status !== "failed")
    .reduce((sum, p) => addMoney(sum, p.amount), money("0", currency));
}

/**
 * Available balance for a merchant: gross confirmed payments minus the platform
 * take-rate (application fees) minus amounts already committed to prior (pending
 * or paid) payouts. Pure bigint math. `platformFees` defaults to zero so a
 * caller that applies no take-rate keeps the original gross-minus-reserved
 * behavior. The fee total is computed by `@settlekit/platform-billing` and
 * passed in, keeping this package decoupled from the fee schedule.
 */
export function computeAvailableBalance(
  payments: readonly Payment[],
  priorPayouts: readonly Payout[],
  currency: Money["currency"] = "USDC",
  platformFees: Money = money("0", currency),
): Money {
  const gross = grossConfirmed(payments, currency);
  const reserved = reservedByPayouts(priorPayouts, currency);
  return subtractMoney(subtractMoney(gross, platformFees), reserved);
}

/** Input required to create a payout. */
export interface CreatePayoutInput {
  organizationId: string;
  walletAddress: string;
  /** Decimal major-unit amount string, e.g. "100.5". */
  amount: string;
  network: PayoutNetwork;
  /** Confirmed payments backing the merchant balance. */
  payments: readonly Payment[];
  /** Payouts already created for this merchant. */
  priorPayouts: readonly Payout[];
  /** Platform take-rate already accrued on the backing payments (defaults to 0). */
  platformFees?: Money;
}

/**
 * Create a pending payout, validating that the amount is positive and does not
 * exceed the merchant's currently available balance.
 */
export function createPayout(
  input: CreatePayoutInput,
  generate: () => string,
  now: Date = new Date(),
): Result<Payout, SettleKitError> {
  if (input.organizationId.length === 0) return err(validationError("organizationId is required"));
  if (input.walletAddress.length === 0) return err(validationError("walletAddress is required"));

  let amount: Money;
  try {
    amount = money(input.amount);
  } catch (cause) {
    return err(validationError(`invalid payout amount ${JSON.stringify(input.amount)}`, { cause: String(cause) }));
  }

  if (compareMoney(amount, money("0", amount.currency)) <= 0) {
    return err(validationError("payout amount must be positive", { amount: amount.amount }));
  }

  const available = computeAvailableBalance(
    input.payments,
    input.priorPayouts,
    amount.currency,
    input.platformFees ?? money("0", amount.currency),
  );
  if (compareMoney(amount, available) > 0) {
    return err(
      validationError("payout amount exceeds available balance", {
        requested: amount.amount,
        available: available.amount,
        organizationId: input.organizationId,
      }),
    );
  }

  const payout: Payout = {
    id: generate(),
    organizationId: input.organizationId,
    walletAddress: input.walletAddress,
    amount,
    network: input.network,
    status: "pending",
    createdAt: toIso(now),
  };
  return ok(payout);
}

/** Mark a pending payout as paid with its settlement tx hash (immutable copy). */
export function markPaid(payout: Payout, txHash: string, now: Date = new Date()): Result<Payout, SettleKitError> {
  if (payout.status !== "pending") {
    return err(conflict(`cannot pay a payout in status ${payout.status}`, { payoutId: payout.id }));
  }
  if (txHash.length === 0) {
    return err(validationError("txHash is required to mark a payout paid", { payoutId: payout.id }));
  }
  return ok({ ...payout, status: "paid", txHash, failureReason: undefined, paidAt: toIso(now) });
}

/** Mark a pending payout as failed (immutable copy). */
export function markFailed(payout: Payout, reason: string, _now: Date = new Date()): Result<Payout, SettleKitError> {
  if (payout.status !== "pending") {
    return err(conflict(`cannot fail a payout in status ${payout.status}`, { payoutId: payout.id }));
  }
  return ok({ ...payout, status: "failed", failureReason: reason });
}
