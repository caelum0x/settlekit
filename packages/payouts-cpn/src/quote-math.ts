/**
 * Deterministic quote math for the local off-ramp provider (and a reusable
 * helper for the CPN adapter's fallback). USDC arithmetic is done in bigint
 * base units only — NEVER floats — so fee and destination amounts are exact.
 *
 * common's multiplyMoney only accepts a non-negative integer quantity, so a
 * fractional fee (e.g. 0.5%) is computed via toBaseUnits/fromBaseUnits with
 * basis-points integer math instead.
 */

import { type Money, fromBaseUnits, money, subtractMoney, toBaseUnits } from "@settlekit/common";

/** Fee charged by the local provider, in basis points (0.5%). */
export const LOCAL_FEE_BPS = 50n;

const BPS_DENOMINATOR = 10_000n;

/** Compute a fee in USDC as `amount * bps / 10_000`, truncated to base units. */
export function feeForAmount(amount: Money, bps: bigint = LOCAL_FEE_BPS): Money {
  const base = toBaseUnits(amount.amount);
  const fee = (base * bps) / BPS_DENOMINATOR;
  return money(fromBaseUnits(fee));
}

/**
 * Net USDC after subtracting the fee. The local provider off-ramps at a flat
 * 1.0 rate (1 USDC -> 1 destination unit), so the destination amount equals the
 * net USDC amount expressed as a decimal string.
 */
export function netAfterFee(amount: Money, fee: Money): Money {
  return subtractMoney(amount, fee);
}
