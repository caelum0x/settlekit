import {
  fromBaseUnits,
  toBaseUnits,
  validationError,
  type Money,
} from "@settlekit/common";

/** Plan §32: marketplace take rate is bounded to 5%–15%. */
export const MIN_FEE_BPS = 500; // 5%
export const MAX_FEE_BPS = 1_500; // 15%
const BPS_DENOMINATOR = 10_000n;

/**
 * Compute the marketplace fee for a gross {@link Money} amount at a basis-point
 * rate. The fee is computed on integer base units to avoid floating-point
 * error, rounding down (floor) so the platform never over-charges.
 *
 * @param amount  Gross transaction amount.
 * @param feeBps  Fee in basis points, constrained to 500..1500 (5%..15%).
 */
export function marketplaceFee(amount: Money, feeBps: number): Money {
  if (!Number.isInteger(feeBps)) {
    throw validationError("feeBps must be an integer", { received: feeBps });
  }
  if (feeBps < MIN_FEE_BPS || feeBps > MAX_FEE_BPS) {
    throw validationError("feeBps out of allowed range", {
      min: MIN_FEE_BPS,
      max: MAX_FEE_BPS,
      received: feeBps,
    });
  }

  const grossBase = toBaseUnits(amount.amount);
  if (grossBase < 0n) {
    throw validationError("Fee cannot be computed for a negative amount");
  }

  const feeBase = (grossBase * BigInt(feeBps)) / BPS_DENOMINATOR;
  return {
    amount: fromBaseUnits(feeBase),
    currency: amount.currency,
  };
}

/**
 * Split a gross amount into the platform fee and the seller's net payout.
 * fee + net always reconstitutes the original gross exactly (no leakage).
 */
export interface FeeSplit {
  gross: Money;
  fee: Money;
  net: Money;
}

export function splitFee(amount: Money, feeBps: number): FeeSplit {
  const fee = marketplaceFee(amount, feeBps);
  const netBase = toBaseUnits(amount.amount) - toBaseUnits(fee.amount);
  return {
    gross: amount,
    fee,
    net: { amount: fromBaseUnits(netBase), currency: amount.currency },
  };
}
