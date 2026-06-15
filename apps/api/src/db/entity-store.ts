/**
 * Async entity-store abstraction used by API routes for resources that have no
 * dedicated @settlekit package store (products, prices, customers, delivery
 * runs, webhook endpoints/events, github/discord integration records).
 *
 * Both backends implement the same async interface so the route layer is
 * persistence-agnostic: {@link InMemoryEntityStore} for zero-infra dev/test, and
 * a Postgres-backed implementation (see ./pg/*) when DATABASE_URL is set.
 */

/** A minimal id-keyed async store with list + filter + delete. */
export interface EntityStore<T extends { id: string }> {
  save(entity: T): Promise<T>;
  findById(id: string): Promise<T | null>;
  list(predicate?: (entity: T) => boolean): Promise<T[]>;
  delete(id: string): Promise<boolean>;
}

/** Deep clone so stored records never alias caller state (immutability). */
function clone<T>(value: T): T {
  return structuredClone(value);
}

/** A real in-memory {@link EntityStore} (not a mock — full working store). */
export class InMemoryEntityStore<T extends { id: string }> implements EntityStore<T> {
  private readonly byId = new Map<string, T>();

  async save(entity: T): Promise<T> {
    const stored = clone(entity);
    this.byId.set(stored.id, stored);
    return clone(stored);
  }

  async findById(id: string): Promise<T | null> {
    const found = this.byId.get(id);
    return found ? clone(found) : null;
  }

  async list(predicate?: (entity: T) => boolean): Promise<T[]> {
    const all = [...this.byId.values()].map(clone);
    return predicate ? all.filter(predicate) : all;
  }

  async delete(id: string): Promise<boolean> {
    return this.byId.delete(id);
  }
}
