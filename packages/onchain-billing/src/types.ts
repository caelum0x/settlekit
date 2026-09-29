/**
 * Records for onchain subscriptions, their per-period charges and Base
 * escrow payments. Every record is plain JSON (bigints as decimal strings)
 * so stores can persist them as documents; every transition returns a copy.
 */
import type { PaymentNetwork } from "@settlekit/common";

/** Every network onchain billing can bill on (HyperCore is invoice-only). */
export type BillingNetwork = PaymentNetwork | "hypercore";

/**
 * How a subscription is collected each period:
 *  - `spend_permission`  Base Account smart wallets (SpendPermissionManager)
 *  - `permit2`           any EVM EOA via Permit2 AllowanceTransfer
 *  - `spl_delegate`      Solana SPL `approve` to the operator as delegate
 *  - `renewal_invoice`   a checkout link emailed each period (HyperCore, Zcash, any)
 */
export type BillingMethod = "spend_permission" | "permit2" | "spl_delegate" | "renewal_invoice";

export const BILLING_METHODS: readonly BillingMethod[] = ["spend_permission", "permit2", "spl_delegate", "renewal_invoice"];

export type OnchainSubscriptionStatus =
  /** Intent created; waiting for the buyer's signed grant. */
  | "pending_grant"
  | "active"
  /** Latest charge failed; dunning retries are scheduled. */
  | "past_due"
  /** Dunning exhausted; entitlements suspended. */
  | "suspended"
  | "canceled";

/** Permit2 AllowanceTransfer grant (EOAs on every EVM chain). */
export interface Permit2Grant {
  kind: "permit2";
  chainId: number;
  owner: string;
  token: string;
  spender: string;
  /** uint160 cap = price x periods, decimal string. */
  amount: string;
  /** uint48 unix seconds. */
  expiration: number;
  /** uint48 Permit2 nonce the signature binds. */
  nonce: number;
  sigDeadline: string;
  signature: string;
  /** `permit()` submission once registered onchain. */
  permitTxHash?: string;
}

/** Base Account SpendPermission, JSON-safe (uint fields as decimal strings). */
export interface SpendPermissionJson {
  account: string;
  spender: string;
  token: string;
  allowance: string;
  period: number;
  start: number;
  end: number;
  salt: string;
  extraData: string;
}

export interface SpendPermissionGrant {
  kind: "spend_permission";
  chainId: number;
  permission: SpendPermissionJson;
  signature: string;
  approveTxHash?: string;
}

export interface SplDelegateGrant {
  kind: "spl_delegate";
  cluster: "mainnet" | "devnet";
  owner: string;
  /** The owner's token account the delegate may debit. */
  tokenAccount: string;
  mint: string;
  delegate: string;
  /** Delegated cap in base units, decimal string. */
  delegatedAmount: string;
  /** Signature of the buyer's approve transaction. */
  approveSignature: string;
}

export interface RenewalInvoiceGrant {
  kind: "renewal_invoice";
  /** Where renewal links are emailed. */
  email: string;
}

/** What the buyer was asked to sign, kept until the signed grant comes back. */
export type PendingIntent =
  | { kind: "permit2"; chainId: number; owner: string; token: string; spender: string; amount: string; expiration: number; nonce: number; sigDeadline: string }
  | { kind: "spend_permission"; chainId: number; permission: SpendPermissionJson }
  | { kind: "spl_delegate"; cluster: "mainnet" | "devnet"; owner: string; tokenAccount: string; mint: string; delegate: string; amount: string }
  | { kind: "renewal_invoice"; email: string };

export type BillingGrant = Permit2Grant | SpendPermissionGrant | SplDelegateGrant | RenewalInvoiceGrant;

export interface OnchainSubscription {
  id: string;
  organizationId: string;
  customerId: string;
  productId: string;
  priceId: string;
  /** Linked core `Subscription` id (extended / suspended by the worker). */
  subscriptionId?: string;
  network: BillingNetwork;
  method: BillingMethod;
  /** Buyer wallet (EVM account, Solana owner, or empty for invoice billing). */
  payer: string;
  /** Merchant recipient. */
  payTo: string;
  /** Token address / mint billed ("" for invoice billing). */
  token: string;
  decimals: number;
  /** Amount per period in base units, decimal string. */
  amountPerPeriod: string;
  /** Display amount per period (major units, USDC-equivalent). */
  amountDisplay: string;
  periodSeconds: number;
  /** Periods the grant covers (cap = price x periods). */
  periodsCovered: number;
  /** ISO start of period 0; set when the grant is accepted. */
  anchorAt?: string;
  /** Highest period index already collected (-1 for none). */
  paidThrough: number;
  status: OnchainSubscriptionStatus;
  intent?: PendingIntent;
  grant?: BillingGrant;
  /** Checkout session recording this subscription purchase (payments reference it). */
  checkoutSessionId?: string;
  /** Stop charging after the current paid period. */
  cancelAtPeriodEnd: boolean;
  lastChargeError?: string;
  customerEmail?: string;
  createdAt: string;
  updatedAt: string;
  canceledAt?: string;
}

export type ChargeStatus = "pending" | "succeeded" | "failed" | "awaiting_payment";

export interface ChargeStep {
  step: string;
  txHash: string;
  at: string;
}

/** One collection attempt for (subscription, period) — unique per pair. */
export interface OnchainCharge {
  id: string;
  onchainSubscriptionId: string;
  periodIndex: number;
  network: BillingNetwork;
  method: BillingMethod;
  /** Base units, decimal string. */
  amount: string;
  status: ChargeStatus;
  /** 1-based attempt counter for this period. */
  attempt: number;
  /** A pending charge is owned by one worker until this instant. */
  leaseUntil: string;
  /** Broadcast transactions, recorded before confirmation (crash recovery). */
  steps: readonly ChargeStep[];
  /** Settling transaction (the pull that moved funds to the merchant). */
  txHash?: string;
  /** Renewal checkout session id for invoice billing. */
  invoiceRef?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export type ClaimResult =
  | { kind: "claimed"; charge: OnchainCharge }
  | { kind: "already_succeeded"; charge: OnchainCharge }
  | { kind: "in_flight"; charge: OnchainCharge }
  | { kind: "awaiting_payment"; charge: OnchainCharge };

export interface ClaimInput {
  subscription: OnchainSubscription;
  periodIndex: number;
  now: Date;
  leaseMs: number;
  newId: () => string;
}
