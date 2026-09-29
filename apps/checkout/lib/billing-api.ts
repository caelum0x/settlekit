/**
 * Server-side client for the SettleKit onchain-billing API
 * (`/v1/onchain-billing/*`). The hosted checkout authenticates with the
 * platform service token (SETTLEKIT_SERVICE_TOKEN) and names the checkout
 * session's seller in `X-SettleKit-Organization`; the API only accepts that
 * token under /v1/onchain-billing. Never imported by client components: no
 * key ever reaches the browser.
 */

import { apiBaseUrl } from "./payment-link";
import { CheckoutError } from "./errors";

export type BillingMethod = "spend_permission" | "permit2" | "spl_delegate" | "renewal_invoice";

export interface PayerCall {
  to: string;
  data: string;
  chainId: number;
  description: string;
}

/** What the buyer's wallet must do to authorize the subscription. */
export type BuyerAction =
  | { kind: "sign_typed_data"; typedData: TypedDataJson; payerCalls: PayerCall[] }
  | { kind: "send_transaction"; transaction: string; encoding: "base64"; network: "solana" }
  | { kind: "send_calls"; payerCalls: PayerCall[] }
  | { kind: "none" };

/** EIP-712 typed data with bigints already rendered as decimal strings. */
export interface TypedDataJson {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface OnchainSubscriptionRecord {
  id: string;
  organizationId: string;
  customerId: string;
  productId: string;
  priceId: string;
  network: string;
  method: BillingMethod;
  payer: string;
  payTo: string;
  status: "pending_grant" | "active" | "past_due" | "suspended" | "canceled";
  amountDisplay: string;
  periodSeconds: number;
  periodsCovered: number;
  anchorAt?: string;
  checkoutSessionId?: string;
  intent?: Record<string, unknown> & { kind: string };
  cancelAtPeriodEnd: boolean;
}

export interface ChargeView {
  id: string;
  periodIndex: number;
  status: "pending" | "succeeded" | "failed" | "awaiting_payment";
  amount: string;
  txHash: string | null;
  explorerUrl: string | null;
  failureReason: string | null;
  invoiceRef: string | null;
  updatedAt: string;
}

/** API read model (apps/api/src/onchain-billing/views.ts). */
export interface SubscriptionView {
  id: string;
  status: OnchainSubscriptionRecord["status"];
  dunning: "none" | "retrying" | "suspended";
  network: string;
  networkName: string;
  method: BillingMethod;
  customerEmail: string | null;
  payer: string;
  productId: string;
  productName: string;
  amountPerPeriod: string;
  interval: "monthly" | "yearly";
  periodsCovered: number;
  cap: string;
  grantExpiresAt: string | null;
  currentPeriodEnd: string | null;
  nextChargeAt: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  lastChargeError: string | null;
  lastCharge: ChargeView | null;
  charges: ChargeView[];
}

export interface BillingNetworkInfo {
  network: string;
  chainId?: number;
  token: string;
  symbol: string;
  methods: BillingMethod[];
}

export interface BillingNetworks {
  networks: BillingNetworkInfo[];
  operator: string | null;
  solanaDelegate: string | null;
}

export interface CreateIntentResult {
  subscription: OnchainSubscriptionRecord;
  action: BuyerAction;
}

export interface GrantResult {
  subscription: OnchainSubscriptionRecord;
  firstCharge: { outcome: string; charge?: { status: string; txHash?: string; invoiceRef?: string; failureReason?: string } | null };
}

export interface CancelResultJson {
  subscription: OnchainSubscriptionRecord;
  buyerRevoke?: BuyerAction;
  operatorRevokeTx?: string;
  view: SubscriptionView;
}

/** Whether subscriptions can be offered from this checkout deployment. */
export function billingConfigured(): boolean {
  return (process.env.SETTLEKIT_SERVICE_TOKEN?.trim() ?? "").length >= 32;
}

async function call<T>(organizationId: string, path: string, init?: RequestInit): Promise<T> {
  const token = process.env.SETTLEKIT_SERVICE_TOKEN?.trim();
  if (!token) throw new CheckoutError("network_not_configured", "Subscriptions are not enabled on this checkout.");
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/v1/onchain-billing${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-settlekit-organization": organizationId,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new CheckoutError("provider_unavailable", "The billing service is unreachable. Try again in a moment.");
  }
  const body = (await res.json().catch(() => null)) as { data?: T; error?: { message?: string; code?: string } } | null;
  if (!res.ok || body?.data === undefined) {
    const message = body?.error?.message ?? `Billing request failed (${res.status})`;
    if (res.status === 404) throw new CheckoutError("session_not_found", message);
    if (res.status === 400 || res.status === 422) throw new CheckoutError("invalid_request", message);
    throw new CheckoutError("provider_unavailable", message);
  }
  return body.data;
}

export const billingApi = {
  networks: (org: string) => call<BillingNetworks>(org, "/networks"),
  createSubscription: (org: string, input: Record<string, unknown>) =>
    call<CreateIntentResult>(org, "/subscriptions", { method: "POST", body: JSON.stringify(input) }),
  subscription: (org: string, id: string) =>
    call<{ subscription: OnchainSubscriptionRecord; view: SubscriptionView }>(org, `/subscriptions/${encodeURIComponent(id)}`),
  grant: (org: string, id: string, input: { signature?: string; approveSignature?: string }) =>
    call<GrantResult>(org, `/subscriptions/${encodeURIComponent(id)}/grant`, { method: "POST", body: JSON.stringify(input) }),
  cancel: (org: string, id: string) =>
    call<CancelResultJson>(org, `/subscriptions/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ atPeriodEnd: true, by: "buyer" }),
    }),
};
