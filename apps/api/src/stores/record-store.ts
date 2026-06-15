/**
 * A tiny, real in-memory record store used by the API for resources whose
 * domain package does not ship its own store (products, prices, customers,
 * integration records, delivery runs, webhook endpoints/events).
 *
 * It is NOT a mock: every method does real work and returns deep copies so
 * callers cannot mutate persisted state through retained references, matching
 * the immutability guarantees the domain packages rely on.
 */

/** Deep-clone via structured clone so stored records never alias caller state. */
function clone<T>(value: T): T {
  return structuredClone(value);
}

/** A generic id-keyed store with list + filter support. */
export class RecordStore<T extends { id: string }> {
  private readonly byId = new Map<string, T>();

  /** Insert or replace `entity`, returning the stored copy. */
  save(entity: T): T {
    const stored = clone(entity);
    this.byId.set(stored.id, stored);
    return clone(stored);
  }

  /** Look up by id, or `null` when absent. */
  findById(id: string): T | null {
    const found = this.byId.get(id);
    return found ? clone(found) : null;
  }

  /** List every record, optionally filtered by a predicate. Newest-id order. */
  list(predicate?: (entity: T) => boolean): T[] {
    const all = [...this.byId.values()].map(clone);
    return predicate ? all.filter(predicate) : all;
  }

  /** Remove a record by id; returns true when one was deleted. */
  delete(id: string): boolean {
    return this.byId.delete(id);
  }

  /** Number of stored records. */
  get size(): number {
    return this.byId.size;
  }
}
