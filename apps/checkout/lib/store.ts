/**
 * Server-side data layer for the checkout app.
 *
 * Delegates to a {@link CheckoutBackend} selected by `DATABASE_URL`:
 *   - Postgres: reads the REAL catalog + sessions the API/dashboard persisted
 *     and records/settles payments into the shared Postgres tables.
 *   - Seed: an in-process catalog for standalone local dev.
 *
 * Every state transition goes through the real `@settlekit/payments` lifecycle
 * functions; this module never mutates a domain object in place. The confirmed
 * payment and delivered access for a session are DERIVED on read (via
 * `findByCheckoutSessionId` + deterministic `materializeDelivery`) so results
 * are correct across multiple server instances backed by one database.
 */
import {
  recordPendingPayment,
  confirmPayment,
  completeSession,
  expireSession,
  isSessionExpired,
} from "@settlekit/payments";
import {
  money,
  type CheckoutSession,
  type DeliveryAction,
  type Payment,
  type Price,
  type Product,
} from "@settlekit/common";

import { getBackend, type CheckoutBackend } from "./backend";
import { materializeDelivery } from "./deliver";
import { verifyOnChainPayment } from "./arc";
import type { DeliveredAccess } from "./types";

/** The confirmed payment for a session, derived from the payment repository. */
async function confirmedPaymentForSession(
  backend: CheckoutBackend,
  sessionId: string,
): Promise<Payment | undefined> {
  const payments = await backend.payments.findByCheckoutSessionId(sessionId);
  return payments.find((p) => p.status === "confirmed");
}

export interface ResolvedSession {
  session: CheckoutSession;
  product: Product;
  price: Price;
  deliveryAction: DeliveryAction;
  merchantName: string;
  expired: boolean;
}

/** Fetch a session and all data needed to render it. */
export async function getResolvedSession(
  sessionId: string,
): Promise<ResolvedSession | undefined> {
  const backend = getBackend();
  const session = await backend.checkouts.findById(sessionId);
  if (!session) return undefined;

  const line = session.lineItems[0];
  const productId = line?.productId;
  if (!productId || !line) return undefined;
  const product = await backend.findProduct(productId);
  const price = await backend.findPrice(line.priceId);
  if (!product || !price) return undefined;
  const deliveryAction = backend.deliveryActionForProduct(product);
  if (!deliveryAction) return undefined;

  const expired = isSessionExpired(session) || session.status === "expired";
  const merchantName = await backend.merchantName(session.merchantId);

  return { session, product, price, deliveryAction, merchantName, expired };
}

/** Persist collected buyer fields onto an open session (immutably). */
export async function saveCollectedFields(
  sessionId: string,
  fields: Record<string, string>,
): Promise<CheckoutSession | undefined> {
  const backend = getBackend();
  const session = await backend.checkouts.findById(sessionId);
  if (!session) return undefined;
  const next: CheckoutSession = {
    ...session,
    collectedFields: { ...session.collectedFields, ...fields },
  };
  await backend.checkouts.save(next);
  return next;
}

export interface ConfirmResult {
  session: CheckoutSession;
  payment: Payment;
}

/**
 * Record + confirm an on-chain payment for a session and complete the session.
 * Uses the real payment lifecycle + checkout completion domain functions.
 */
export async function recordAndConfirm(
  sessionId: string,
  txHash: string,
): Promise<ConfirmResult> {
  const backend = getBackend();
  const session = await backend.checkouts.findById(sessionId);
  if (!session) throw new Error("session_not_found");
  if (session.status === "completed") {
    const existing = await confirmedPaymentForSession(backend, sessionId);
    if (existing) return { session, payment: existing };
  }

  // Verify the transfer on-chain when Arc is configured. A failed verification
  // throws (the route surfaces it as a 409) so a bogus hash never settles a
  // session; when Arc is unconfigured, `verification` is null and we record a
  // single confirmation.
  const amount = money(session.amount.amount, session.amount.currency);
  const verification = await verifyOnChainPayment({
    txHash,
    payTo: session.payToAddress,
    amount,
  });
  if (verification && !verification.ok) {
    throw new Error(verification.reason ?? "on-chain payment verification failed");
  }
  const confirmations = verification?.confirmations ?? 1;
  const minConfirmations = verification?.minConfirmations ?? 1;

  const pending = recordPendingPayment({
    organizationId: session.organizationId,
    checkoutSessionId: session.id,
    customerId: session.customerId ?? `cus_${session.id}`,
    amount,
    network: session.network,
    txHash,
  });
  await backend.payments.save(pending);

  // Settle at the real observed confirmation count (>= the configured minimum).
  const confirmed = confirmPayment(pending, txHash, confirmations, minConfirmations);
  await backend.payments.save(confirmed);

  const completed = completeSession(session);
  await backend.checkouts.save(completed);

  return { session: completed, payment: confirmed };
}

/** Recompute delivered access for a completed session (deterministic). */
export async function getDeliveredAccess(
  sessionId: string,
): Promise<DeliveredAccess[]> {
  const backend = getBackend();
  const session = await backend.checkouts.findById(sessionId);
  if (!session || session.status !== "completed") return [];
  const payment = await confirmedPaymentForSession(backend, sessionId);
  if (!payment) return [];

  const line = session.lineItems[0];
  const product = line?.productId ? await backend.findProduct(line.productId) : undefined;
  const action = product ? backend.deliveryActionForProduct(product) : undefined;
  if (!product || !action) return [];
  return materializeDelivery(payment, action, product, session.collectedFields);
}

/** Look up the confirmed payment for a completed session. */
export async function getConfirmedPayment(
  sessionId: string,
): Promise<Payment | undefined> {
  return confirmedPaymentForSession(getBackend(), sessionId);
}

/** Force a session into the expired state (used by the expired flow). */
export async function markExpired(sessionId: string): Promise<void> {
  const backend = getBackend();
  const session = await backend.checkouts.findById(sessionId);
  if (!session || session.status !== "open") return;
  await backend.checkouts.save(expireSession(session));
}

/** Ids of the seeded demo sessions, for the index/landing page (empty in DB mode). */
export function listSeededSessionIds(): string[] {
  return getBackend().seededSessionIds();
}
