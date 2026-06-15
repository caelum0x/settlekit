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
} from "@settlekit/common";

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
  /** Secondary human-readable detail. */
  detail?: string;
}

/** Receipt + delivered access for the success page. */
export interface ReceiptView {
  sessionId: string;
  paymentId: string;
  txHash: string;
  network: PaymentNetwork;
  amount: Money;
  confirmedAt: string;
  lines: OrderLine[];
  buyer: Record<string, string>;
  access: DeliveredAccess[];
}

/** Request body for POST confirm. */
export interface ConfirmPaymentRequest {
  txHash: string;
  fields: Record<string, string>;
}

export interface ApiError {
  error: string;
}

/** Internal: a product + its delivery action, used for seeding. */
export interface ProductWithDelivery {
  product: Product;
  deliveryAction: DeliveryAction;
}
