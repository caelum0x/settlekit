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
 *
 * Payment confirmation FAILS CLOSED: every network is verified on-chain by
 * `verifySessionPayment`, and a network without a configured verifier can
 * never settle a session. Verification binds the transfer to the session:
 * payTo for the session's network, amount, notBefore = session.createdAt,
 * the declared payer, and per-chain bindings (Solana reference, Tempo memo,
 * locked ZEC quote). A transaction hash settles at most one payment (the
 * unique `payments.tx_hash` index is the claim), and fulfillment runs exactly
 * once per confirmed payment.
 *
 * Every entry point takes an optional {@link StoreDeps} (defaults to the
 * process backend + env-configured verifiers) so tests drive the real logic
 * with in-memory repositories and a fake chain.
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
import { findReference } from "@settlekit/solana";
import { emitWebhookSafely, paymentConfirmedWebhook, type PaymentContext } from "@settlekit/persistence";

import { getBackend, type CheckoutBackend } from "./backend";
import { entitlementIdForPayment, materializeDelivery } from "./deliver";
import { verifyOnChainPayment } from "./arc";
import { CheckoutError, isUniqueViolation } from "./errors";
import { fulfillPayment, type FulfillmentDeps } from "./fulfill";
import { getGitHubDelivery } from "./github-delivery";
import { getDiscordDelivery } from "./discord-delivery";
import { getEvmRuntime } from "./evm";
import { getHyperCoreRuntime } from "./hypercore";
import { getSolanaRuntime } from "./solana";
import { getZcashRuntime } from "./zcash";
import { isWellFormedTxHash, normalizeTxHash, txHashFormatHint } from "./tx-hash";
import { verifySessionPayment, type VerifyDeps } from "./verify-payment";
import type { OnChainVerification } from "./arc";
import type { DeliveredAccess } from "./types";

/** Everything the store needs; injectable for tests. */
export interface StoreDeps {
  backend: CheckoutBackend;
  verify: VerifyDeps;
  fulfillment: FulfillmentDeps;
}

/** Env-configured verifiers for every network (each fails closed when unset). */
export function defaultVerifyDeps(): VerifyDeps {
  return {
    solana: getSolanaRuntime(),
    verifyArc: verifyOnChainPayment,
    evm: getEvmRuntime(),
    zcash: getZcashRuntime(),
    hypercore: getHyperCoreRuntime(),
  };
}

/** Process defaults: `DATABASE_URL` backend + env-configured chains + GitHub App. */
export function defaultStoreDeps(): StoreDeps {
  const backend = getBackend();
  return {
    backend,
    verify: defaultVerifyDeps(),
    fulfillment: { entitlements: backend.entitlements, github: () => getGitHubDelivery(), discord: () => getDiscordDelivery(),
      ...(backend.discordGrants ? { discordGrants: backend.discordGrants } : {}),
    },
  };
}

/** Whether any payment (pending or confirmed) is recorded for a session. */
export async function hasRecordedPayment(backend: CheckoutBackend, sessionId: string): Promise<boolean> {
  const payments = await backend.payments.findByCheckoutSessionId(sessionId);
  return payments.some((p) => p.status === "pending" || p.status === "confirmed");
}

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
  deps: Pick<StoreDeps, "backend"> = { backend: getBackend() },
): Promise<ResolvedSession | undefined> {
  const { backend } = deps;
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
  deps: Pick<StoreDeps, "backend"> = { backend: getBackend() },
): Promise<CheckoutSession | undefined> {
  const session = await deps.backend.checkouts.findById(sessionId);
  if (!session) return undefined;
  const next: CheckoutSession = {
    ...session,
    collectedFields: { ...session.collectedFields, ...fields },
  };
  await deps.backend.checkouts.save(next);
  return next;
}

export interface ConfirmResult {
  session: CheckoutSession;
  payment: Payment;
}

/**
 * Concurrent confirms of one session in this process share a single run, so
 * a buyer double-submitting (or several status pollers) cannot race. Across
 * processes the unique tx-hash index provides the same guarantee.
 */
const inflight = new Map<string, Promise<ConfirmResult>>();

/**
 * Verify, record + confirm an on-chain payment for a session, complete the
 * session and fulfill it once. Idempotent: re-confirming with the tx that
 * already settled the session returns the existing payment.
 *
 * Throws {@link CheckoutError}: `malformed_tx`, `duplicate_tx` (the hash
 * already settled another payment), `verification_failed` (including a
 * network with no configured verifier — fail closed), `session_not_payable`,
 * `payment_pending` (found but not final: poll again) and
 * `payment_under_review` (Zcash paid after the quote expired).
 *
 * A transaction that already pays this session but lacks confirmations (or
 * arrived late) is CLAIMED as a pending payment, so the worker can finish
 * confirming it even if the buyer leaves, and no other session can use it.
 */
export function recordAndConfirm(
  sessionId: string,
  txHash: string,
  deps: StoreDeps = defaultStoreDeps(),
): Promise<ConfirmResult> {
  const running = inflight.get(sessionId);
  if (running) return running;
  const run = confirmOnce(sessionId, txHash, deps).finally(() => inflight.delete(sessionId));
  inflight.set(sessionId, run);
  return run;
}

async function confirmOnce(sessionId: string, rawTxHash: string, deps: StoreDeps): Promise<ConfirmResult> {
  const { backend } = deps;
  const session = await backend.checkouts.findById(sessionId);
  if (!session) throw new CheckoutError("session_not_found", "Checkout session not found.");
  if (session.status === "completed") {
    const existing = await confirmedPaymentForSession(backend, sessionId);
    if (existing) return { session, payment: existing };
  }
  if (!isWellFormedTxHash(session.network, rawTxHash)) {
    throw new CheckoutError("malformed_tx", `Expected ${txHashFormatHint(session.network)}.`);
  }
  const txHash = normalizeTxHash(session.network, rawTxHash);

  // Replay guard: a transaction settles at most one payment.
  const prior = await backend.payments.findByTxHash(txHash);
  if (prior && prior.checkoutSessionId !== session.id) {
    throw new CheckoutError("duplicate_tx", "This transaction has already been used to pay another checkout.");
  }
  if (prior?.status === "confirmed") {
    // Confirmed elsewhere (the worker's payment-confirm / route-watch jobs):
    // finish the session and fulfil once, exactly as a checkout-side confirm.
    if (session.status !== "open") return { session, payment: prior };
    const completed = completeSession(session);
    await backend.checkouts.save(completed);
    await fulfillOnce(deps, completed, prior);
    return { session: completed, payment: prior };
  }
  if (session.status !== "open") {
    throw new CheckoutError("session_not_payable", `This checkout session is ${session.status} and cannot be paid.`);
  }

  const verification = await verifySessionPayment(deps.verify, session, txHash);
  if (!verification.ok) {
    if ((verification.claimable || verification.late) && !prior) await claimTxHash(backend, session, txHash);
    throw unsettledError(verification);
  }

  // Resume a pending row left by an interrupted run, else claim the tx hash.
  const pending = prior ?? (await claimTxHash(backend, session, txHash));

  // Settle at the real observed confirmation count (>= the configured minimum).
  const confirmed = confirmPayment(pending, txHash, verification.confirmations, verification.minConfirmations);
  await backend.payments.save(confirmed);
  const completed = completeSession(session);
  await backend.checkouts.save(completed);

  await fulfillOnce(deps, completed, confirmed);
  return { session: completed, payment: confirmed };
}

/** The buyer-facing error for a verification that did not settle. */
function unsettledError(verification: OnChainVerification): CheckoutError {
  if (verification.late) {
    return new CheckoutError(
      "payment_under_review",
      "Your payment arrived after the price quote expired. It is recorded and under review; the merchant will confirm it.",
    );
  }
  if (verification.pending) {
    return new CheckoutError("payment_pending", verification.reason ?? "The payment is not final yet.");
  }
  return new CheckoutError("verification_failed", verification.reason ?? "On-chain payment verification failed.");
}

/** Insert the pending payment; the unique tx-hash index makes this the claim. */
async function claimTxHash(backend: CheckoutBackend, session: CheckoutSession, txHash: string): Promise<Payment> {
  const pending = recordPendingPayment({
    organizationId: session.organizationId,
    checkoutSessionId: session.id,
    customerId: session.customerId ?? `cus_${session.id}`,
    amount: money(session.amount.amount, session.amount.currency),
    network: session.network,
    txHash,
  });
  try {
    await backend.payments.save(pending);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    throw new CheckoutError(
      "duplicate_tx",
      "This transaction is already recorded for a payment. Refresh to see its status.",
    );
  }
  return pending;
}

const FORWARDED_FIELDS = ["githubUsername", "discordUserId", "discordUsername"] as const;

/** Buyer details a seller's payment.confirmed webhook carries. */
function webhookContext(session: CheckoutSession): PaymentContext {
  const fields = session.collectedFields;
  return {
    ...(fields.email ? { customerEmail: fields.email } : {}),
    productIds: session.lineItems.flatMap((line) => (line.productId ? [line.productId] : [])),
    buyer: Object.fromEntries(FORWARDED_FIELDS.flatMap((key) => (fields[key] ? [[key, fields[key] as string]] : []))),
  };
}

/** Save the buyer (email + delivery ids) so the seller's app can check access by email. */
async function recordCustomer(backend: CheckoutBackend, session: CheckoutSession, payment: Payment): Promise<void> {
  const fields = session.collectedFields;
  if (!backend.customers || !fields.email) return;
  try {
    const existing = await backend.customers.findById(payment.customerId);
    await backend.customers.save({
      ...(existing ?? { id: payment.customerId, organizationId: payment.organizationId, metadata: {}, createdAt: new Date().toISOString() }),
      email: fields.email,
      ...(fields.githubUsername ? { githubUsername: fields.githubUsername } : {}),
      ...(fields.discordUserId ? { discordUserId: fields.discordUserId } : {}),
      ...(session.payerAddress ? { walletAddress: session.payerAddress } : {}),
    });
  } catch (error) {
    console.error(`[checkout] could not record customer for payment ${payment.id}:`, error);
  }
}

/** Run fulfillment for a newly confirmed payment; never fails the payment. */
async function fulfillOnce(deps: StoreDeps, session: CheckoutSession, payment: Payment): Promise<void> {
  await recordCustomer(deps.backend, session, payment);
  await emitWebhookSafely(deps.backend.webhooks, paymentConfirmedWebhook(payment, webhookContext(session)));
  const productId = session.lineItems[0]?.productId;
  const product = productId ? await deps.backend.findProduct(productId) : undefined;
  const action = product ? deps.backend.deliveryActionForProduct(product) : undefined;
  if (!product || !action) return;
  try {
    await fulfillPayment(deps.fulfillment, { payment, product, action, fields: session.collectedFields });
  } catch (error) {
    // The payment is settled on-chain and recorded; a storage/integration
    // failure here must not turn it into an error for the buyer.
    console.error(`[checkout] fulfillment failed for payment ${payment.id}:`, error);
  }
}

export type ReferenceConfirmResult =
  | { status: "pending" }
  | ({ status: "paid" } & ConfirmResult);

/**
 * Solana Pay: look the session's reference up on-chain and, once a payment
 * transaction includes it, verify + confirm it. Idempotent — safe to poll.
 */
export async function confirmFromReference(
  sessionId: string,
  deps: StoreDeps = defaultStoreDeps(),
): Promise<ReferenceConfirmResult> {
  const session = await deps.backend.checkouts.findById(sessionId);
  if (!session) throw new CheckoutError("session_not_found", "Checkout session not found.");
  if (session.network !== "solana") {
    throw new CheckoutError("session_not_payable", "This checkout session is not paid on Solana.");
  }
  if (session.status === "completed") {
    const payment = await confirmedPaymentForSession(deps.backend, sessionId);
    if (payment) return { status: "paid", session, payment };
  }
  if (!deps.verify.solana.ok) throw new CheckoutError("network_not_configured", deps.verify.solana.error);
  if (session.paymentReference === undefined) {
    throw new CheckoutError("missing_reference", "This Solana checkout session has no payment reference.");
  }

  const { rpc, config } = deps.verify.solana.runtime;
  const found = await findReference(rpc, session.paymentReference, { commitment: config.commitment });
  if (!found) return { status: "pending" };
  const result = await recordAndConfirm(sessionId, found.signature, deps);
  return { status: "paid", ...result };
}

/** Recompute delivered access for a completed session (deterministic). */
export async function getDeliveredAccess(
  sessionId: string,
  deps: StoreDeps = defaultStoreDeps(),
): Promise<DeliveredAccess[]> {
  const { backend } = deps;
  const session = await backend.checkouts.findById(sessionId);
  if (!session || session.status !== "completed") return [];
  const payment = await confirmedPaymentForSession(backend, sessionId);
  if (!payment) return [];

  const line = session.lineItems[0];
  const product = line?.productId ? await backend.findProduct(line.productId) : undefined;
  const action = product ? backend.deliveryActionForProduct(product) : undefined;
  if (!product || !action) return [];
  const entitlement = await deps.fulfillment.entitlements.findById(entitlementIdForPayment(payment));
  return materializeDelivery(payment, action, product, session.collectedFields, {
    ...(entitlement ? { entitlement } : {}),
    githubReady: deps.fulfillment.github().ok,
    discordReady: (deps.fulfillment.discord ?? getDiscordDelivery)().ok,
  });
}

/** Look up the confirmed payment for a completed session. */
export async function getConfirmedPayment(
  sessionId: string,
  deps: Pick<StoreDeps, "backend"> = { backend: getBackend() },
): Promise<Payment | undefined> {
  return confirmedPaymentForSession(deps.backend, sessionId);
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
