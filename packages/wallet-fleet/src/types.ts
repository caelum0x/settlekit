/**
 * Wallet-fleet types (RFB 5): a registry of wallets for agents, creators, and
 * authors, with per-wallet spending caps and a kill-switch.
 */

import type { IsoTimestamp, PaymentNetwork } from "@settlekit/common";

export type WalletOwnerType = "agent" | "creator" | "author" | "platform";

/** A managed wallet in the fleet. */
export interface FleetWallet {
  id: string;
  ownerType: WalletOwnerType;
  /** The owning entity's id (agent id, creator id, author handle, etc.). */
  ownerId: string;
  /** On-chain address. */
  address: string;
  network: PaymentNetwork;
  /** Circle programmable-wallet id, when custodied by Circle. */
  circleWalletId?: string;
  label?: string;
  /** When true, all spend is denied (emergency stop). */
  killed: boolean;
  createdAt: IsoTimestamp;
}

/** Input to register a wallet in the fleet. */
export interface RegisterWalletInput {
  ownerType: WalletOwnerType;
  ownerId: string;
  address: string;
  network?: PaymentNetwork;
  circleWalletId?: string;
  label?: string;
}

/** Per-wallet spend limits. */
export interface SpendingCaps {
  /** Max single transfer, decimal USDC. */
  perTxUsdc?: string;
  /** Max cumulative spend per UTC day, decimal USDC. */
  perDayUsdc?: string;
}

/** Whether a spend is authorized, with a reason when not. */
export interface SpendAuthorization {
  allowed: boolean;
  reason?: string;
}
