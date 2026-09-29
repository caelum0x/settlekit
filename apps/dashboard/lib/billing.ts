// Server-only client for onchain billing (/v1/onchain-billing/*): the
// merchant's subscriptions (read model + cancel) and refunds the SettleKit
// operator wallet sends. Authenticated with the merchant's session cookie.
import "server-only";
import { cookies } from "next/headers";
import { API_URL } from "./config";
import type { ActionResult } from "./merchant-types";

export interface SubscriptionCharge {
  id: string;
  periodIndex: number;
  status: "pending" | "succeeded" | "failed" | "awaiting_payment";
  amount: string;
  attempt: number;
  txHash: string | null;
  explorerUrl: string | null;
  failureReason: string | null;
  updatedAt: string;
}

export interface OnchainSubscription {
  id: string;
  subscriptionId: string | null;
  status: "pending_grant" | "active" | "past_due" | "suspended" | "canceled";
  dunning: "none" | "retrying" | "suspended";
  network: string;
  networkName: string;
  method: "spend_permission" | "permit2" | "spl_delegate" | "renewal_invoice";
  customerId: string;
  customerEmail: string | null;
  payer: string;
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
  lastCharge: SubscriptionCharge | null;
  charges: SubscriptionCharge[];
  createdAt: string;
}

export interface RefundRoute {
  paymentId: string;
  network: string;
  route: "escrow_refund" | "evm_transfer" | "solana_transfer" | "hypercore_usd_send" | null;
  automated: boolean;
  to: string | null;
  needsRecipient: boolean;
  operator: string | null;
  reason: string | null;
}

export interface SentRefund {
  refund: { id: string; txHash?: string };
  execution: { route: string; txHash: string; explorerUrl: string | null };
}

export interface SendRefundInput {
  paymentId: string;
  amount: string;
  reason: "duplicate" | "fraudulent" | "customer_request" | "delivery_failed";
  to?: string;
  revokeAccess: boolean;
}

function authHeader(): Record<string, string> {
  const token = cookies().get("sk_session")?.value;
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function call<T>(path: string, init?: RequestInit): Promise<ActionResult<T> & { status: number }> {
  try {
    const res = await fetch(`${API_URL}/v1/onchain-billing${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...authHeader(), ...(init?.headers ?? {}) },
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as { data?: T; error?: { message?: string } } | null;
    if (!res.ok) return { data: null, error: body?.error?.message ?? `API ${res.status}`, status: res.status };
    return { data: (body?.data ?? null) as T | null, error: null, status: res.status };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : "Network error", status: 0 };
  }
}

export const billing = {
  subscriptions: () => call<OnchainSubscription[]>("/subscriptions?view=1"),
  cancel: (id: string, atPeriodEnd: boolean) =>
    call<{ view: OnchainSubscription }>(`/subscriptions/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ atPeriodEnd, by: "merchant" }),
    }),
  refundRoute: (paymentId: string) => call<RefundRoute>(`/refunds/route?paymentId=${encodeURIComponent(paymentId)}`),
  sendRefund: (input: SendRefundInput) => call<SentRefund>("/refunds", { method: "POST", body: JSON.stringify(input) }),
};
