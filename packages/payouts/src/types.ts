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
  /**
   * Provider transaction reference (e.g. the Circle transaction id), set when a
   * payout is executed but not yet settled on-chain. Used to reconcile the
   * eventual txHash.
   */
  providerRef?: string;
  /** Reason a payout failed, set when marked failed. */
  failureReason?: string;
  createdAt: IsoTimestamp;
  paidAt?: IsoTimestamp;
}
