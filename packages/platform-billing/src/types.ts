import type { Money } from "@settlekit/common";

/**
 * The platform take-rate applied to a merchant's gross settlement volume —
 * SettleKit's revenue model. Stripe-style: a percentage (in basis points) plus
 * a fixed per-payment fee.
 */
export interface PlatformFeeSchedule {
  /** Basis points charged on each payment's gross amount (250 = 2.5%). */
  bps: number;
  /** Fixed fee charged per payment, as a decimal major-unit string (e.g. "0.30"). */
  fixed: string;
}

/**
 * A merchant's settlement economics over a set of confirmed payments: the gross
 * they took, the platform's cut, and the net they can withdraw.
 */
export interface PlatformRevenue {
  /** Gross confirmed volume. */
  grossVolume: Money;
  /** Total platform fees across the payments (SettleKit revenue). */
  platformFees: Money;
  /** Gross minus platform fees — the merchant's withdrawable settlement. */
  netToMerchant: Money;
  /** Number of confirmed payments the figures are computed from. */
  paymentCount: number;
  /** The schedule the fees were computed under. */
  schedule: PlatformFeeSchedule;
}
