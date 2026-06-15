import type { DownloadGrant } from "./grants.js";

/**
 * Persistence boundary for download grants. The domain logic depends on this
 * narrow interface, not on any concrete database. A real deployment ships a
 * SQL/KV-backed implementation; tests use the in-memory implementation below
 * (a real implementation of THIS interface, used to drive pure domain logic).
 */
export interface GrantStore {
  /** Persist a new grant. Rejects if a grant with the same id already exists. */
  create(grant: DownloadGrant): Promise<DownloadGrant>;
  /** Look up a grant by id, or null if not found. */
  get(id: string): Promise<DownloadGrant | null>;
  /** Look up a grant by its opaque download token, or null if not found. */
  getByDownloadToken(downloadToken: string): Promise<DownloadGrant | null>;
  /**
   * Replace the stored grant with the same id. Rejects if the grant does not
   * exist. Returns the saved grant.
   */
  update(grant: DownloadGrant): Promise<DownloadGrant>;
  /** List all grants for a file (e.g. to revoke on refund). */
  listByFile(fileId: string): Promise<DownloadGrant[]>;
  /** List all grants for a customer. */
  listByCustomer(customerId: string): Promise<DownloadGrant[]>;
}

/**
 * In-memory GrantStore. Real implementation of the GrantStore contract backed
 * by a Map. Suitable for tests, single-process workers, and local development.
 * Stores deep copies so callers cannot mutate persisted state.
 */
export class InMemoryGrantStore implements GrantStore {
  private readonly byId = new Map<string, DownloadGrant>();
  private readonly tokenToId = new Map<string, string>();

  async create(grant: DownloadGrant): Promise<DownloadGrant> {
    if (this.byId.has(grant.id)) {
      throw new Error(`grant already exists: ${grant.id}`);
    }
    if (this.tokenToId.has(grant.downloadToken)) {
      throw new Error(`download token already in use: ${grant.downloadToken}`);
    }
    const copy = { ...grant };
    this.byId.set(copy.id, copy);
    this.tokenToId.set(copy.downloadToken, copy.id);
    return { ...copy };
  }

  async get(id: string): Promise<DownloadGrant | null> {
    const found = this.byId.get(id);
    return found ? { ...found } : null;
  }

  async getByDownloadToken(downloadToken: string): Promise<DownloadGrant | null> {
    const id = this.tokenToId.get(downloadToken);
    if (!id) return null;
    const found = this.byId.get(id);
    return found ? { ...found } : null;
  }

  async update(grant: DownloadGrant): Promise<DownloadGrant> {
    if (!this.byId.has(grant.id)) {
      throw new Error(`grant not found: ${grant.id}`);
    }
    const copy = { ...grant };
    this.byId.set(copy.id, copy);
    // Keep the token index consistent (token is immutable in practice).
    this.tokenToId.set(copy.downloadToken, copy.id);
    return { ...copy };
  }

  async listByFile(fileId: string): Promise<DownloadGrant[]> {
    return [...this.byId.values()].filter((g) => g.fileId === fileId).map((g) => ({ ...g }));
  }

  async listByCustomer(customerId: string): Promise<DownloadGrant[]> {
    return [...this.byId.values()]
      .filter((g) => g.customerId === customerId)
      .map((g) => ({ ...g }));
  }

  /** Number of grants currently stored (test/diagnostic helper). */
  size(): number {
    return this.byId.size;
  }
}
