/**
 * Server-side data layer for the checkout app.
 *
 * Backed by the real @settlekit/payments in-memory repositories plus the
 * pricing catalog needed to render order summaries. Seeded with live demo
 * products + open checkout sessions so the hosted pages render against real
 * domain objects (real CheckoutSession / Payment / Product / Price records).
 *
 * A single module-level singleton survives across route-handler invocations
 * within a server process (Next.js caches the module), giving the API a
 * consistent store. State transitions go exclusively through @settlekit
 * domain functions — this module never mutates a domain object in place.
 */
import {
  createCheckoutSession,
  recordPendingPayment,
  confirmPayment,
  completeSession,
  expireSession,
  isSessionExpired,
  InMemoryCheckoutRepository,
  InMemoryPaymentRepository,
  type PricedLineItem,
} from "@settlekit/payments";
import {
  money,
  type CheckoutSession,
  type DeliveryAction,
  type Payment,
  type Price,
  type Product,
} from "@settlekit/common";

import { seedCatalog, type SeededProduct } from "./seed";
import { materializeDelivery } from "./deliver";
import type { DeliveredAccess } from "./types";

/** The full state the data layer holds. */
interface StoreState {
  readonly checkouts: InMemoryCheckoutRepository;
  readonly payments: InMemoryPaymentRepository;
  /** priceId -> Price. */
  readonly prices: Map<string, Price>;
  /** productId -> Product. */
  readonly products: Map<string, Product>;
  /** productId -> delivery action that fulfills it. */
  readonly delivery: Map<string, DeliveryAction>;
  /** merchantId -> display name. */
  readonly merchants: Map<string, string>;
  /** sessionId -> confirmed payment id (for receipt lookup). */
  readonly sessionPayment: Map<string, string>;
  /** Ordered seeded session ids for the demo index page. */
  readonly seededSessionIds: string[];
  /** sessionId -> materialized delivered access (computed once at confirm). */
  readonly delivered: Map<string, DeliveredAccess[]>;
}

let singleton: StoreState | undefined;

/** Lazily build + seed the store on first access. */
function state(): StoreState {
  if (singleton) return singleton;

  const checkouts = new InMemoryCheckoutRepository();
  const payments = new InMemoryPaymentRepository();
  const prices = new Map<string, Price>();
  const products = new Map<string, Product>();
  const delivery = new Map<string, DeliveryAction>();
  const merchants = new Map<string, string>();
  const sessionPayment = new Map<string, string>();
  const seededSessionIds: string[] = [];
  const delivered = new Map<string, DeliveredAccess[]>();

  const seeded = seedCatalog();
  for (const item of seeded.products) {
    products.set(item.product.id, item.product);
    prices.set(item.price.id, item.price);
    delivery.set(item.product.id, item.deliveryAction);
  }
  for (const [id, name] of Object.entries(seeded.merchants)) {
    merchants.set(id, name);
  }

  singleton = {
    checkouts,
    payments,
    prices,
    products,
    delivery,
    merchants,
    sessionPayment,
    seededSessionIds,
    delivered,
  };

  // Seed open sessions (one per demo product) using the real domain factory.
  for (const item of seeded.products) {
    const session = createSeedSession(item);
    s_save(singleton, session);
    seededSessionIds.push(session.id);
  }

  return singleton;
}

/** Build a real open checkout session for a seeded product (pure factory). */
function createSeedSession(item: SeededProduct): CheckoutSession {
  const items: PricedLineItem[] = [
    {
      lineItem: {
        productId: item.product.id,
        priceId: item.price.id,
        quantity: 1,
      },
      price: item.price,
    },
  ];
  return createCheckoutSession({
    organizationId: item.product.organizationId,
    merchantId: item.product.merchantId,
    items,
    payToAddress: item.payToAddress,
    network: item.network,
    ttlDays: 365,
  });
}

/**
 * Persist a session synchronously. The in-memory repository's `save` writes to
 * its backing Map synchronously and returns a resolved promise; we intentionally
 * don't await during module-init seeding (the write has already landed).
 */
function s_save(s: StoreState, session: CheckoutSession): void {
  void s.checkouts.save(session);
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
  const s = state();
  const session = await s.checkouts.findById(sessionId);
  if (!session) return undefined;

  const line = session.lineItems[0];
  const productId = line?.productId;
  if (!productId) return undefined;
  const product = s.products.get(productId);
  const price = line ? s.prices.get(line.priceId) : undefined;
  const deliveryAction = s.delivery.get(productId);
  if (!product || !price || !deliveryAction) return undefined;

  const expired = isSessionExpired(session) || session.status === "expired";
  const merchantName = s.merchants.get(session.merchantId) ?? "Merchant";

  return { session, product, price, deliveryAction, merchantName, expired };
}

/** Persist collected buyer fields onto an open session (immutably). */
export async function saveCollectedFields(
  sessionId: string,
  fields: Record<string, string>,
): Promise<CheckoutSession | undefined> {
  const s = state();
  const session = await s.checkouts.findById(sessionId);
  if (!session) return undefined;
  const next: CheckoutSession = {
    ...session,
    collectedFields: { ...session.collectedFields, ...fields },
  };
  await s.checkouts.save(next);
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
  const s = state();
  const session = await s.checkouts.findById(sessionId);
  if (!session) throw new Error("session_not_found");
  if (session.status === "completed") {
    const existingId = s.sessionPayment.get(sessionId);
    const existing = existingId ? await s.payments.findById(existingId) : undefined;
    if (existing) return { session, payment: existing };
  }

  const pending = recordPendingPayment({
    organizationId: session.organizationId,
    checkoutSessionId: session.id,
    customerId: session.customerId ?? `cus_${session.id}`,
    amount: money(session.amount.amount, session.amount.currency),
    network: session.network,
    txHash,
  });
  await s.payments.save(pending);

  // One confirmation observed → settle.
  const confirmed = confirmPayment(pending, txHash, 1);
  await s.payments.save(confirmed);

  const completed = completeSession(session);
  await s.checkouts.save(completed);
  s.sessionPayment.set(sessionId, confirmed.id);

  // Materialize + cache delivered access once, so the success page is stable.
  const line = completed.lineItems[0];
  const productId = line?.productId;
  const product = productId ? s.products.get(productId) : undefined;
  const action = productId ? s.delivery.get(productId) : undefined;
  if (product && action) {
    const access = materializeDelivery(
      confirmed,
      action,
      product,
      completed.collectedFields,
    );
    s.delivered.set(sessionId, access);
  }

  return { session: completed, payment: confirmed };
}

/** Cached delivered access for a completed session. */
export async function getDeliveredAccess(
  sessionId: string,
): Promise<DeliveredAccess[]> {
  return state().delivered.get(sessionId) ?? [];
}

/** Look up the confirmed payment for a completed session. */
export async function getConfirmedPayment(
  sessionId: string,
): Promise<Payment | undefined> {
  const s = state();
  const id = s.sessionPayment.get(sessionId);
  if (!id) return undefined;
  return (await s.payments.findById(id)) ?? undefined;
}

/** Force a session into the expired state (used by the expired flow). */
export async function markExpired(sessionId: string): Promise<void> {
  const s = state();
  const session = await s.checkouts.findById(sessionId);
  if (!session || session.status !== "open") return;
  await s.checkouts.save(expireSession(session));
}

/** Ids of the seeded demo sessions, for the index/landing page. */
export function listSeededSessionIds(): string[] {
  return [...state().seededSessionIds];
}
