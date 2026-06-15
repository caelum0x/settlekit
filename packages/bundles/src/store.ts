import type { Bundle } from "@settlekit/common";

/** Filters for listing bundles. */
export interface ListBundlesOptions {
  /** Restrict to a single organization. */
  organizationId?: string;
  /** Restrict to a single merchant. */
  merchantId?: string;
  /** When true, only return bundles whose status is "active". */
  activeOnly?: boolean;
}

/**
 * Persistence boundary for bundles. Concrete implementations back this with a
 * real datastore (Postgres, etc.); the in-memory implementation in this package
 * is a real, fully-working store used by tests and local development.
 */
export interface BundleStore {
  /** Look up a bundle by id, or null when none exists. */
  findById(id: string): Promise<Bundle | null>;

  /** Insert or replace a bundle, returning the stored copy. */
  save(bundle: Bundle): Promise<Bundle>;

  /** List bundles, newest first, optionally filtered. */
  list(options?: ListBundlesOptions): Promise<Bundle[]>;

  /** Remove a bundle by id; returns true when a bundle was deleted. */
  delete(id: string): Promise<boolean>;
}

/**
 * A real, fully-functional in-memory {@link BundleStore}. Stores deep copies so
 * callers cannot mutate persisted state through retained references, preserving
 * the package's immutability guarantees.
 */
export class InMemoryBundleStore implements BundleStore {
  private readonly bundles = new Map<string, Bundle>();

  constructor(seed: readonly Bundle[] = []) {
    for (const bundle of seed) {
      this.bundles.set(bundle.id, clone(bundle));
    }
  }

  async findById(id: string): Promise<Bundle | null> {
    const found = this.bundles.get(id);
    return found ? clone(found) : null;
  }

  async save(bundle: Bundle): Promise<Bundle> {
    const stored = clone(bundle);
    this.bundles.set(stored.id, stored);
    return clone(stored);
  }

  async list(options: ListBundlesOptions = {}): Promise<Bundle[]> {
    return [...this.bundles.values()]
      .filter((b) =>
        options.organizationId ? b.organizationId === options.organizationId : true,
      )
      .filter((b) => (options.merchantId ? b.merchantId === options.merchantId : true))
      .filter((b) => (options.activeOnly ? b.status === "active" : true))
      .sort((a, b) => compareDesc(a.createdAt, b.createdAt))
      .map(clone);
  }

  async delete(id: string): Promise<boolean> {
    return this.bundles.delete(id);
  }

  /** Number of stored bundles (test/inspection helper). */
  get size(): number {
    return this.bundles.size;
  }
}

/** Sort comparator: newest ISO timestamp first. */
function compareDesc(a: string, b: string): number {
  if (a < b) return 1;
  if (a > b) return -1;
  return 0;
}

/**
 * Deep clone via JSON round-trip. Bundles are plain JSON-serializable data, so
 * this is correct and avoids depending on the `structuredClone` global.
 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
