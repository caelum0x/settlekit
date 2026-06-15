import type { Entitlement } from "@settlekit/common";
import { SettleKitError, toIso } from "@settlekit/common";
import { assertPositiveAmount, verifyCredits } from "./verify.js";

/**
 * Deduct `amount` credits from an entitlement, returning a NEW entitlement
 * (immutable). Throws a SettleKitError with code `insufficient_credits` when the
 * balance would go negative.
 */
export function deductCredits(
  entitlement: Entitlement,
  amount: number,
  now: Date = new Date(),
): Entitlement {
  assertPositiveAmount(amount);
  const remaining = entitlement.creditsRemaining ?? 0;
  if (remaining < amount) {
    throw new SettleKitError({
      code: "insufficient_credits",
      message: `insufficient credits: ${remaining} available, ${amount} requested`,
      details: { entitlementId: entitlement.id, available: remaining, requested: amount },
    });
  }
  return {
    ...entitlement,
    creditsRemaining: remaining - amount,
    updatedAt: toIso(now),
  };
}

/**
 * Add `amount` credits to an entitlement (e.g. top-up / renewal), returning a
 * NEW entitlement. Treats a missing balance as zero.
 */
export function addCredits(
  entitlement: Entitlement,
  amount: number,
  now: Date = new Date(),
): Entitlement {
  assertPositiveAmount(amount);
  const remaining = entitlement.creditsRemaining ?? 0;
  return {
    ...entitlement,
    creditsRemaining: remaining + amount,
    updatedAt: toIso(now),
  };
}

export { verifyCredits };
