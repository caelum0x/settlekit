/**
 * Checkout session domain logic (plan §15, Phase 1).
 *
 * Pure functions only — no DB, no network. Every function returns a NEW
 * immutable object; existing inputs are never mutated.
 */

import {
  addDays,
  generateId,
  money,
  multiplyMoney,
  addMoney,
  toIso,
  isPast,
  validationError,
  conflict,
  type CheckoutSession,
  type CheckoutLineItem,
  type Money,
  type PaymentNetwork,
  type Price,
} from "@settlekit/common";

/** Default checkout session lifetime, in days, before it expires. */
export const DEFAULT_CHECKOUT_TTL_DAYS = 1;

/** A line item paired with its resolved price for total computation. */
export interface PricedLineItem {
  readonly lineItem: CheckoutLineItem;
  readonly price: Price;
}

export interface CreateCheckoutSessionInput {
  readonly organizationId: string;
  readonly merchantId: string;
  readonly customerId?: string;
  /** Line items each paired with their resolved Price for total math. */
  readonly items: ReadonlyArray<PricedLineItem>;
  /** Address the buyer must pay to (merchant payout wallet or gateway). */
  readonly payToAddress: string;
  readonly network: PaymentNetwork;
  readonly successUrl?: string;
  readonly cancelUrl?: string;
  readonly collectedFields?: Readonly<Record<string, string>>;
  /** Session lifetime in days; defaults to DEFAULT_CHECKOUT_TTL_DAYS. */
  readonly ttlDays?: number;
}

/**
 * Compute the total Money for a set of priced line items.
 *
 * Each line's price.amount (major-unit decimal string) is multiplied by the
 * line quantity, then summed. Usage-based prices have no fixed total here and
 * contribute zero (they are billed per metered unit downstream).
 */
export function computeCheckoutTotal(
  items: ReadonlyArray<PricedLineItem>,
): Money {
  let total = money("0");
  for (const { lineItem, price } of items) {
    if (!Number.isInteger(lineItem.quantity) || lineItem.quantity < 1) {
      throw validationError(
        `Line item quantity must be a positive integer, got ${lineItem.quantity}`,
        { priceId: lineItem.priceId },
      );
    }
    if (price.usageBased) {
      // Usage-based lines are metered later; they add nothing to the upfront total.
      continue;
    }
    const lineTotal = multiplyMoney(
      money(price.amount, price.currency),
      lineItem.quantity,
    );
    total = addMoney(total, lineTotal);
  }
  return total;
}

/**
 * Create a new open checkout session.
 *
 * Computes the total Money from the line items + their prices, sets expiresAt
 * (now + ttl), stores payToAddress, and starts in status "open".
 */
export function createCheckoutSession(
  input: CreateCheckoutSessionInput,
  now: Date = new Date(),
): CheckoutSession {
  if (input.items.length === 0) {
    throw validationError("Checkout session requires at least one line item");
  }
  if (input.payToAddress.trim().length === 0) {
    throw validationError("Checkout session requires a payToAddress");
  }

  const ttlDays = input.ttlDays ?? DEFAULT_CHECKOUT_TTL_DAYS;
  if (!Number.isInteger(ttlDays) || ttlDays < 1) {
    throw validationError(`ttlDays must be a positive integer, got ${ttlDays}`);
  }

  const amount = computeCheckoutTotal(input.items);
  const lineItems: CheckoutLineItem[] = input.items.map(({ lineItem }) => ({
    ...lineItem,
  }));

  return {
    id: generateId("checkoutSession"),
    organizationId: input.organizationId,
    merchantId: input.merchantId,
    ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
    lineItems,
    amount,
    status: "open",
    payToAddress: input.payToAddress,
    network: input.network,
    ...(input.successUrl !== undefined ? { successUrl: input.successUrl } : {}),
    ...(input.cancelUrl !== undefined ? { cancelUrl: input.cancelUrl } : {}),
    expiresAt: toIso(addDays(now, ttlDays)),
    collectedFields: { ...(input.collectedFields ?? {}) },
    createdAt: toIso(now),
  };
}

/**
 * Merge buyer-supplied delivery fields (github username, discord id, etc.)
 * into an open session. Returns a NEW session; the input is not mutated.
 */
export function collectFields(
  session: CheckoutSession,
  fields: Readonly<Record<string, string>>,
): CheckoutSession {
  if (session.status !== "open") {
    throw conflict(
      `Cannot collect fields on a ${session.status} session`,
      { sessionId: session.id, status: session.status },
    );
  }
  return {
    ...session,
    collectedFields: { ...session.collectedFields, ...fields },
  };
}

/**
 * Transition an open session to "expired". Returns a NEW session.
 *
 * Only "open" sessions may be expired. Already-completed or canceled sessions
 * raise a conflict so callers cannot silently clobber a terminal state.
 */
export function expireSession(
  session: CheckoutSession,
): CheckoutSession {
  if (session.status === "expired") {
    return session;
  }
  if (session.status !== "open") {
    throw conflict(
      `Cannot expire a ${session.status} session`,
      { sessionId: session.id, status: session.status },
    );
  }
  return { ...session, status: "expired" };
}

/**
 * Mark an open session "completed" once a payment has confirmed.
 * Returns a NEW session.
 */
export function completeSession(
  session: CheckoutSession,
): CheckoutSession {
  if (session.status === "completed") {
    return session;
  }
  if (session.status !== "open") {
    throw conflict(
      `Cannot complete a ${session.status} session`,
      { sessionId: session.id, status: session.status },
    );
  }
  return { ...session, status: "completed" };
}

/** Cancel an open session (buyer abandoned). Returns a NEW session. */
export function cancelSession(
  session: CheckoutSession,
): CheckoutSession {
  if (session.status === "canceled") {
    return session;
  }
  if (session.status !== "open") {
    throw conflict(
      `Cannot cancel a ${session.status} session`,
      { sessionId: session.id, status: session.status },
    );
  }
  return { ...session, status: "canceled" };
}

/** True when the session's expiresAt is in the past relative to `now`. */
export function isSessionExpired(
  session: CheckoutSession,
  now: Date = new Date(),
): boolean {
  return isPast(session.expiresAt, now);
}
