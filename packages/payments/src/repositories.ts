/**
 * Repository interfaces for the payments domain.
 *
 * These are storage-agnostic contracts: the domain logic depends only on these
 * interfaces, never on a concrete database. A real DB-backed implementation
 * lives in @settlekit/database; an in-memory implementation usable in dev and
 * tests ships in ./in-memory-repositories.ts.
 *
 * All methods are async so the same interface works for in-memory Maps and
 * real network/database stores.
 */

import type { CheckoutSession, Payment, Subscription } from "@settlekit/common";

/** Generic persistence contract: look up by id, upsert by id. */
export interface Repository<T> {
  /** Return the entity with `id`, or null if it does not exist. */
  findById(id: string): Promise<T | null>;
  /** Insert or replace the entity, returning the stored value. */
  save(entity: T): Promise<T>;
}

export interface CheckoutRepository extends Repository<CheckoutSession> {
  /** All sessions for a customer, newest first. */
  findByCustomerId(customerId: string): Promise<CheckoutSession[]>;
}

export interface PaymentRepository extends Repository<Payment> {
  /** All payments recorded against a checkout session, newest first. */
  findByCheckoutSessionId(checkoutSessionId: string): Promise<Payment[]>;
  /** Look up a payment by its on-chain transaction hash, or null. */
  findByTxHash(txHash: string): Promise<Payment | null>;
}

export interface SubscriptionRepository extends Repository<Subscription> {
  /** All subscriptions belonging to a customer, newest first. */
  findByCustomerId(customerId: string): Promise<Subscription[]>;
}
