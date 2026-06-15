/**
 * Real, working in-memory implementations of the payments repositories.
 *
 * These are Map-backed stores that fully honour the repository contracts and
 * are usable in development, local demos, and tests. They are NOT mocks: every
 * method does real work (insert, replace, index lookups, defensive copying).
 *
 * Stored entities are deep-cloned on save and read so callers cannot mutate the
 * store's internal state by holding a reference — matching the immutability
 * guarantees the domain logic relies on.
 */

import type { CheckoutSession, Payment, Subscription } from "@settlekit/common";
import type {
  CheckoutRepository,
  PaymentRepository,
  SubscriptionRepository,
} from "./repositories.js";

/** Structured-clone an entity so the store never shares references with callers. */
function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Sort entities by their ISO `createdAt`, newest first. */
function newestFirst<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export class InMemoryCheckoutRepository implements CheckoutRepository {
  private readonly store = new Map<string, CheckoutSession>();

  async findById(id: string): Promise<CheckoutSession | null> {
    const found = this.store.get(id);
    return found ? clone(found) : null;
  }

  async save(entity: CheckoutSession): Promise<CheckoutSession> {
    const stored = clone(entity);
    this.store.set(stored.id, stored);
    return clone(stored);
  }

  async findByCustomerId(customerId: string): Promise<CheckoutSession[]> {
    const matches = [...this.store.values()].filter(
      (s) => s.customerId === customerId,
    );
    return newestFirst(matches).map(clone);
  }

  /** Number of stored sessions (handy in tests/dev tooling). */
  size(): number {
    return this.store.size;
  }
}

export class InMemoryPaymentRepository implements PaymentRepository {
  private readonly store = new Map<string, Payment>();

  async findById(id: string): Promise<Payment | null> {
    const found = this.store.get(id);
    return found ? clone(found) : null;
  }

  async save(entity: Payment): Promise<Payment> {
    const stored = clone(entity);
    this.store.set(stored.id, stored);
    return clone(stored);
  }

  async findByCheckoutSessionId(
    checkoutSessionId: string,
  ): Promise<Payment[]> {
    const matches = [...this.store.values()].filter(
      (p) => p.checkoutSessionId === checkoutSessionId,
    );
    return newestFirst(matches).map(clone);
  }

  async findByTxHash(txHash: string): Promise<Payment | null> {
    for (const p of this.store.values()) {
      if (p.txHash === txHash) {
        return clone(p);
      }
    }
    return null;
  }

  async findConfirmedByOrganization(organizationId: string): Promise<Payment[]> {
    const matches = [...this.store.values()].filter(
      (p) => p.organizationId === organizationId && p.status === "confirmed",
    );
    return newestFirst(matches).map(clone);
  }

  size(): number {
    return this.store.size;
  }
}

export class InMemorySubscriptionRepository
  implements SubscriptionRepository
{
  private readonly store = new Map<string, Subscription>();

  async findById(id: string): Promise<Subscription | null> {
    const found = this.store.get(id);
    return found ? clone(found) : null;
  }

  async save(entity: Subscription): Promise<Subscription> {
    const stored = clone(entity);
    this.store.set(stored.id, stored);
    return clone(stored);
  }

  async findByCustomerId(customerId: string): Promise<Subscription[]> {
    const matches = [...this.store.values()].filter(
      (s) => s.customerId === customerId,
    );
    return newestFirst(matches).map(clone);
  }

  size(): number {
    return this.store.size;
  }
}

/** Convenience bundle of all three in-memory repositories. */
export interface InMemoryPaymentStores {
  readonly checkouts: InMemoryCheckoutRepository;
  readonly payments: InMemoryPaymentRepository;
  readonly subscriptions: InMemorySubscriptionRepository;
}

/** Construct a fresh set of in-memory repositories for dev/tests. */
export function createInMemoryPaymentStores(): InMemoryPaymentStores {
  return {
    checkouts: new InMemoryCheckoutRepository(),
    payments: new InMemoryPaymentRepository(),
    subscriptions: new InMemorySubscriptionRepository(),
  };
}
