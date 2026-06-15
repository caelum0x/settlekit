import type { Entitlement } from "@settlekit/common";
import { isActive } from "./lifecycle.js";
import type { EntitlementRepository, ListByCustomerOptions } from "./repository.js";

/**
 * A real, fully-functional in-memory implementation of EntitlementRepository.
 * Stores deep copies so callers cannot mutate persisted state through retained
 * references (preserves immutability guarantees). Suitable for tests and local
 * development; swap for a database-backed implementation in production.
 */
export class InMemoryEntitlementRepository implements EntitlementRepository {
  private readonly store = new Map<string, Entitlement>();

  constructor(seed: readonly Entitlement[] = []) {
    for (const entitlement of seed) {
      this.store.set(entitlement.id, clone(entitlement));
    }
  }

  async findActiveByCustomerProduct(
    customerId: string,
    productId: string,
  ): Promise<Entitlement | null> {
    const matches = [...this.store.values()].filter(
      (e) => e.customerId === customerId && e.productId === productId && isActive(e),
    );
    if (matches.length === 0) return null;
    // Most recently updated active entitlement wins.
    const latest = matches.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
    return clone(latest);
  }

  async findById(id: string): Promise<Entitlement | null> {
    const found = this.store.get(id);
    return found ? clone(found) : null;
  }

  async save(entitlement: Entitlement): Promise<Entitlement> {
    const stored = clone(entitlement);
    this.store.set(stored.id, stored);
    return clone(stored);
  }

  async listByCustomer(
    customerId: string,
    options: ListByCustomerOptions = {},
  ): Promise<Entitlement[]> {
    return [...this.store.values()]
      .filter((e) => e.customerId === customerId)
      .filter((e) => (options.productId ? e.productId === options.productId : true))
      .filter((e) => (options.activeOnly ? isActive(e) : true))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .map(clone);
  }

  /** Number of stored entitlements (test/inspection helper). */
  get size(): number {
    return this.store.size;
  }
}

/**
 * Deep clone via JSON round-trip. Entitlements are plain JSON-serializable data
 * (strings, numbers, booleans, nested records), so this is correct and avoids a
 * dependency on the `structuredClone` global / Node lib.
 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
