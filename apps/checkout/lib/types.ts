/**
 * Wire types shared between the checkout API route handlers and the fetch
 * client. These are the JSON shapes the API returns; they are derived from the
 * @settlekit/common domain types but flattened for transport.
 */
import type {
  CheckoutSession,
  DeliveryAction,
  Money,
  PaymentNetwork,
  Product,
  SettlementQuote,
} from "@settlekit/common";

import type { NetworkOption } from "./network-options";

export type { NetworkOption } from "./network-options";

/** A single required buyer field the checkout form must collect. */
export interface CollectedFieldSpec {
  /** Stable key stored in session.collectedFields, e.g. "githubUsername". */
  key: string;
  /** Human label shown in the form. */
  label: string;
  /** Helper text under the field. */
  help: string;
  /** HTML input type. */
  inputType: "text" | "email";
  required: boolean;
  placeholder: string;
  /** Account connection (OAuth) that fills this field, e.g. "Connect Discord". */
  connect?: { url: string; label: string; connectedAs: string | null };
}

/** Order line, resolved with product + price for display. */
export interface OrderLine {
  priceId: string;
  productId?: string;
  bundleId?: string;
  name: string;
  description: string;
  quantity: number;
  /** Per-unit price. */
  unitAmount: Money;
  /** unitAmount * quantity. */
  lineTotal: Money;
}

/** Full checkout session view returned to the page. */
export interface CheckoutSessionView {
  id: string;
  status: CheckoutSession["status"];
  network: PaymentNetwork;
  payToAddress: string;
  amount: Money;
  lines: OrderLine[];
  collectedFields: Record<string, string>;
  requiredFields: CollectedFieldSpec[];
  expiresAt: string;
  expired: boolean;
  merchantName: string;
  /** The session's current network with labels + availability. */
  networkOption: NetworkOption;
  /** Accepted networks this checkout can take payment on right now. */
  networkOptions: NetworkOption[];
  /** Locked ZEC quote (Zcash sessions). */
  settlementQuote: SettlementQuote | null;
  /** Wallet bound as the payer, if declared. */
  payerAddress: string | null;
  /** Whether "pay with any token" (route providers) is offered for this network. */
  anyToken: { available: boolean; reason?: string };
  /** Billing interval when the product is sold as a subscription (buyer can subscribe). */
  recurring: "monthly" | "yearly" | null;
}

/** A delivered entitlement / access surfaced on the success page. */
export interface DeliveredAccess {
  kind:
    | "github_invite"
    | "license_key"
    | "api_key"
    | "file_download"
    | "discord_role"
    | "saas_entitlement";
  title: string;
  /** Primary value (key, link, invite url). */
  value: string;
  /** Whether `value` is a URL that should render as a link. */
  isLink: boolean;
  /** Paid but not yet delivered (e.g. GitHub App setup pending). */
  pending?: boolean;
  /** Secondary human-readable detail. */
  detail?: string;
}

/** Receipt + delivered access for the success page. */
export interface ReceiptView {
  sessionId: string;
  paymentId: string;
  txHash: string;
  /** Block explorer link for `txHash` ("" when unknown). */
  explorerUrl: string;
  network: PaymentNetwork;
  /** Display name of the settlement network, e.g. "Base Sepolia". */
  networkName: string;
  /** Asset actually paid (USDC, USDG, USDC.e, pathUSD, ZEC). */
  asset: string;
  /** What was paid on-chain, e.g. "25 USDG" or "0.01738 ZEC (25 USD)". */
  settledLabel: string;
  amount: Money;
  confirmedAt: string;
  lines: OrderLine[];
  buyer: Record<string, string>;
  access: DeliveredAccess[];
  /** The seller's https return URL (payment links opened with successUrl). */
  returnUrl: string | null;
}

/** Request body for POST confirm. */
export interface ConfirmPaymentRequest {
  txHash: string;
  fields: Record<string, string>;
}

/** POST solana/pay-url response: the Solana Pay request for this session. */
export interface SolanaPayUrlResponse {
  /** Solana Pay transfer-request URL (QR payload, works in any Solana Pay wallet). */
  transferUrl: string;
  /** Solana Pay transaction-request URL (server-built transaction); https origins only. */
  transactionUrl: string | null;
  reference: string;
  cluster: "mainnet" | "devnet";
}

/** POST solana/tx response (Solana Pay transaction-request shape). */
export interface SolanaTxResponse {
  /** Unsigned base64 wire transaction; the buyer's wallet signs + sends it. */
  transaction: string;
  message: string;
}

/** GET solana/status response. */
export type SolanaStatusResponse =
  | { status: "pending" }
  | { status: "paid"; txHash: string; explorerUrl: string };

export interface ApiError {
  error: string;
  code?: string;
}

/** POST network response. */
export interface NetworkSelectResponse {
  network: PaymentNetwork;
  payToAddress: string;
  settlementQuote: SettlementQuote | null;
}

/** Internal: a product + its delivery action, used for seeding. */
export interface ProductWithDelivery {
  product: Product;
  deliveryAction: DeliveryAction;
}
