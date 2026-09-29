/**
 * Recurring checkout (server side): when the session's price is monthly or
 * yearly, the buyer can subscribe instead of paying once.
 *
 *   offer    which authorization methods the session's network supports and
 *            exactly what each one lets SettleKit collect (cap, expiry)
 *   start    saves the buyer's fields and asks the API for the intent: the
 *            typed data / transaction the buyer's wallet signs
 *   complete forwards the signed grant; the API registers it, charges the
 *            first period and delivers access
 *
 * All calls go through /v1/onchain-billing with the checkout's service token
 * (lib/billing-api), scoped to the session's seller.
 */
import { multiplyMoney, money, type CheckoutSession, type PaymentNetwork } from "@settlekit/common";

import { billingApi, billingConfigured, type BillingMethod, type BuyerAction, type OnchainSubscriptionRecord } from "./billing-api";
import { CheckoutError } from "./errors";
import { requiredFieldsForDelivery, sanitizeFields, validateFields } from "./fields";
import { describeNetwork } from "./format";
import { managePath } from "./manage-token";
import { getResolvedSession, saveCollectedFields, type ResolvedSession } from "./store";
import { configuredSolanaCluster } from "./solana";
import { payToFor } from "./verify-payment";

/** Collected-field key linking the buyer's session to its subscription intent. */
export const SUBSCRIBE_INTENT_FIELD = "subscribeIntentId";

const DEFAULT_PERIODS = { monthly: 12, yearly: 2 } as const;
const PERIOD_DAYS = { monthly: 30, yearly: 365 } as const;
const INVOICE_ONLY: readonly PaymentNetwork[] = ["hypercore", "zcash"];

export type Interval = "monthly" | "yearly";

export interface MethodOption {
  method: BillingMethod;
  label: string;
  description: string;
  wallet: "evm" | "solana" | null;
}

export interface SubscriptionOffer {
  available: boolean;
  reason: string | null;
  interval: Interval;
  /** Price per period (USD stablecoin, major units). */
  amount: string;
  periods: number;
  /** price x periods: the most any wallet grant can ever pay out. */
  cap: string;
  /** When a wallet grant made now would stop allowing charges. */
  grantEndsAt: string;
  network: PaymentNetwork;
  networkName: string;
  methods: MethodOption[];
  /** Solana cluster the wallet signs on (Solana sessions). */
  solanaCluster: "mainnet" | "devnet";
  /** Already subscribed from this checkout. */
  existing: { status: OnchainSubscriptionRecord["status"]; manageUrl: string } | null;
}

export interface SubscriptionTerms {
  perPeriod: string;
  interval: Interval;
  periods: number;
  cap: string;
  /** ISO time the authorization expires; null = until revoked (the cap still applies). */
  expiresAt: string | null;
  /** Who can pull funds (the SettleKit operator), when a wallet grant is used. */
  spender: string | null;
  payTo: string;
}

export interface StartSubscriptionResult {
  subscriptionId: string;
  method: BillingMethod;
  action: BuyerAction;
  terms: SubscriptionTerms;
}

export interface CompleteSubscriptionResult {
  status: OnchainSubscriptionRecord["status"];
  outcome: string;
  manageUrl: string;
  /** Renewal-invoice subscriptions: the checkout that pays the first period. */
  invoiceUrl: string | null;
  txHash: string | null;
  failure: string | null;
}

const METHOD_COPY: Readonly<Record<BillingMethod, Omit<MethodOption, "method">>> = {
  spend_permission: {
    label: "Smart wallet spend permission",
    description: "For Base Account / Coinbase smart wallets. You sign one permission that allows at most one period's price per period.",
    wallet: "evm",
  },
  permit2: {
    label: "Wallet allowance (Permit2)",
    description: "Works with any EVM wallet. You approve a capped allowance that expires after the last covered period.",
    wallet: "evm",
  },
  spl_delegate: {
    label: "Solana token delegate",
    description: "You approve SettleKit as a delegate on your USDC account, capped at the total below. Revoke any time.",
    wallet: "solana",
  },
  renewal_invoice: {
    label: "Renewal invoice by email",
    description: "Nothing is pulled from your wallet. Each period we email a payment link; access continues when you pay it.",
    wallet: null,
  },
};

export function recurringInterval(resolved: ResolvedSession): Interval | null {
  const { price, session } = resolved;
  if (price.usageBased) return null;
  // Renewal-invoice checkouts are themselves one period of a subscription.
  if (session.collectedFields.periodIndex !== undefined) return null;
  return price.interval === "monthly" || price.interval === "yearly" ? price.interval : null;
}

function capFor(amount: string, periods: number): string {
  return multiplyMoney(money(amount), periods).amount;
}

function addDays(from: Date, days: number): string {
  return new Date(from.getTime() + days * 86_400_000).toISOString();
}

async function resolveRecurring(sessionId: string): Promise<{ resolved: ResolvedSession; interval: Interval }> {
  const resolved = await getResolvedSession(sessionId);
  if (!resolved) throw new CheckoutError("session_not_found", "Checkout session not found.");
  const interval = recurringInterval(resolved);
  if (!interval) throw new CheckoutError("session_not_payable", "This product is not sold as a subscription.");
  return { resolved, interval };
}

async function existingSubscription(session: CheckoutSession): Promise<SubscriptionOffer["existing"]> {
  const id = session.collectedFields[SUBSCRIBE_INTENT_FIELD];
  if (!id) return null;
  try {
    const { subscription } = await billingApi.subscription(session.organizationId, id);
    if (subscription.status === "pending_grant") return null;
    return { status: subscription.status, manageUrl: managePath(subscription.id, session.organizationId) };
  } catch {
    return null;
  }
}

/** What subscribing looks like on the session's current network. */
export async function getSubscriptionOffer(sessionId: string): Promise<SubscriptionOffer> {
  const { resolved, interval } = await resolveRecurring(sessionId);
  const { session, price } = resolved;
  const periods = DEFAULT_PERIODS[interval];
  const base: SubscriptionOffer = {
    available: false,
    reason: null,
    interval,
    amount: money(price.amount).amount,
    periods,
    cap: capFor(price.amount, periods),
    grantEndsAt: addDays(new Date(), PERIOD_DAYS[interval] * periods),
    network: session.network,
    networkName: describeNetwork(session.network).name,
    methods: [],
    solanaCluster: configuredSolanaCluster(),
    existing: null,
  };
  if (!billingConfigured()) return { ...base, reason: "Subscriptions are not enabled on this checkout yet." };
  if (session.status !== "open" || resolved.expired) return { ...base, reason: "This checkout is no longer open." };
  const existing = await existingSubscription(session);
  let networks;
  try {
    networks = await billingApi.networks(session.organizationId);
  } catch (error) {
    return { ...base, existing, reason: error instanceof Error ? error.message : "Subscriptions are unavailable right now." };
  }
  const entry = networks.networks.find((n) => n.network === session.network);
  const allowed = (entry?.methods ?? []).filter((m) => !INVOICE_ONLY.includes(session.network) || m === "renewal_invoice");
  const methods = allowed.map((method) => ({ method, ...METHOD_COPY[method] }));
  return {
    ...base,
    existing,
    methods,
    available: methods.length > 0,
    reason: methods.length > 0 ? null : `Subscriptions are not available on ${base.networkName}. Choose another network above.`,
  };
}

function termsFor(sub: OnchainSubscriptionRecord, interval: Interval): SubscriptionTerms {
  const intent = sub.intent ?? { kind: "renewal_invoice" };
  const common = {
    perPeriod: sub.amountDisplay,
    interval,
    periods: sub.periodsCovered,
    cap: capFor(sub.amountDisplay, sub.periodsCovered),
    payTo: sub.payTo,
  };
  switch (intent.kind) {
    case "permit2":
      return { ...common, expiresAt: new Date(Number(intent.expiration) * 1000).toISOString(), spender: String(intent.spender) };
    case "spend_permission": {
      const permission = intent.permission as { end: number | string; spender: string };
      return { ...common, expiresAt: new Date(Number(permission.end) * 1000).toISOString(), spender: permission.spender };
    }
    case "spl_delegate":
      return { ...common, expiresAt: null, spender: String(intent.delegate) };
    default:
      return { ...common, cap: common.perPeriod, expiresAt: null, spender: null };
  }
}

export interface StartSubscriptionInput {
  method: unknown;
  payer: unknown;
  fields: Record<string, unknown>;
}

const METHODS: readonly BillingMethod[] = ["spend_permission", "permit2", "spl_delegate", "renewal_invoice"];

/** Save fields and create the subscription intent the buyer's wallet signs. */
export async function startSubscription(sessionId: string, input: StartSubscriptionInput): Promise<StartSubscriptionResult> {
  const { resolved, interval } = await resolveRecurring(sessionId);
  const { session, product, price, deliveryAction } = resolved;
  if (session.status !== "open" || resolved.expired) {
    throw new CheckoutError("session_not_payable", "This checkout is no longer open.");
  }
  const method = typeof input.method === "string" ? (input.method as BillingMethod) : undefined;
  if (!method || !METHODS.includes(method)) throw new CheckoutError("invalid_request", "Choose how to authorize the subscription.");
  const specs = requiredFieldsForDelivery(deliveryAction);
  const problems = validateFields(specs, input.fields);
  if (problems.length > 0) throw new CheckoutError("fields_incomplete", problems.join(" "));
  const fields = sanitizeFields(specs, input.fields);
  const payer = typeof input.payer === "string" ? input.payer.trim() : "";
  if (method !== "renewal_invoice" && payer.length === 0) {
    throw new CheckoutError("invalid_request", "Connect the wallet that will pay the subscription.");
  }

  const intent = await billingApi.createSubscription(session.organizationId, {
    network: session.network,
    method,
    customerId: session.customerId ?? `cus_${session.id}`,
    productId: product.id,
    priceId: price.id,
    payTo: payToFor(session, session.network),
    ...(method !== "renewal_invoice" ? { payer } : {}),
    ...(fields.email ? { email: fields.email } : {}),
  });
  await saveCollectedFields(sessionId, { ...fields, [SUBSCRIBE_INTENT_FIELD]: intent.subscription.id });
  return {
    subscriptionId: intent.subscription.id,
    method,
    action: intent.action,
    terms: termsFor(intent.subscription, interval),
  };
}

export interface CompleteSubscriptionInput {
  subscriptionId: unknown;
  signature: unknown;
  approveSignature: unknown;
}

/** Submit the signed grant; the API activates, charges period 0 and delivers access. */
export async function completeSubscription(sessionId: string, input: CompleteSubscriptionInput): Promise<CompleteSubscriptionResult> {
  const { resolved } = await resolveRecurring(sessionId);
  const { session } = resolved;
  const id = typeof input.subscriptionId === "string" ? input.subscriptionId : "";
  if (!id || session.collectedFields[SUBSCRIBE_INTENT_FIELD] !== id) {
    throw new CheckoutError("invalid_request", "This subscription does not belong to this checkout.");
  }
  const grant = await billingApi.grant(session.organizationId, id, {
    ...(typeof input.signature === "string" && input.signature ? { signature: input.signature } : {}),
    ...(typeof input.approveSignature === "string" && input.approveSignature ? { approveSignature: input.approveSignature } : {}),
  });
  const charge = grant.firstCharge.charge ?? null;
  const invoiceRef = charge?.invoiceRef ?? null;
  return {
    status: grant.subscription.status,
    outcome: grant.firstCharge.outcome,
    manageUrl: managePath(id, session.organizationId),
    invoiceUrl: invoiceRef ? `/c/${encodeURIComponent(invoiceRef)}` : null,
    txHash: charge?.txHash ?? null,
    failure: grant.firstCharge.outcome === "succeeded" || invoiceRef ? null : (charge?.failureReason ?? null),
  };
}
