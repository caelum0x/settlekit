import type { IsoTimestamp, Money } from "@settlekit/common";

/** Settlement networks payouts can be sent over. */
export type PayoutNetwork = "arc" | "base" | "ethereum";

/** Lifecycle of a merchant payout. */
export type PayoutStatus = "pending" | "paid" | "failed";

/**
 * A settlement of funds from the platform to a merchant organization's wallet.
 */
export interface Payout {
  id: string;
  organizationId: string;
  walletAddress: string;
  amount: Money;
  network: PayoutNetwork;
  status: PayoutStatus;
  /** On-chain transaction hash, set when marked paid. */
  txHash?: string;
  /** Reason a payout failed, set when marked failed. */
  failureReason?: string;
  createdAt: IsoTimestamp;
  paidAt?: IsoTimestamp;
}
