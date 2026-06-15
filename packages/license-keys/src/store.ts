import { type LicenseKey } from "@settlekit/common";

/**
 * Persistence boundary for license keys. The domain logic depends only on this
 * narrow interface; a real deployment ships a database-backed implementation
 * (e.g. Postgres) and tests drive the in-memory implementation below.
 */
export interface LicenseStore {
  /** Persist a new or updated license. Returns the stored copy. */
  save(license: LicenseKey): Promise<LicenseKey>;
  /** Look up by license id (lic_...). */
  findById(id: string): Promise<LicenseKey | null>;
  /** Look up by the opaque key string presented to the buyer. */
  findByKey(key: string): Promise<LicenseKey | null>;
  /** All licenses belonging to a customer. */
  listByCustomer(customerId: string): Promise<LicenseKey[]>;
}

/**
 * Real, fully-functional in-memory {@link LicenseStore}. Stores deep copies so
 * callers cannot mutate persisted state by reference — matching the immutability
 * guarantees a remote store would provide.
 */
export class InMemoryLicenseStore implements LicenseStore {
  private readonly byId = new Map<string, LicenseKey>();
  private readonly idByKey = new Map<string, string>();

  private clone(license: LicenseKey): LicenseKey {
    return {
      ...license,
      activatedMachineIds: [...license.activatedMachineIds],
      activatedDomains: [...license.activatedDomains],
    };
  }

  async save(license: LicenseKey): Promise<LicenseKey> {
    const stored = this.clone(license);
    // If this license previously had a different key string (e.g. after a
    // rotation), drop the stale mapping so the old key no longer resolves.
    const previous = this.byId.get(stored.id);
    if (previous && previous.key !== stored.key) {
      this.idByKey.delete(previous.key);
    }
    this.byId.set(stored.id, stored);
    this.idByKey.set(stored.key, stored.id);
    return this.clone(stored);
  }

  async findById(id: string): Promise<LicenseKey | null> {
    const found = this.byId.get(id);
    return found ? this.clone(found) : null;
  }

  async findByKey(key: string): Promise<LicenseKey | null> {
    const id = this.idByKey.get(key);
    if (!id) return null;
    const found = this.byId.get(id);
    return found ? this.clone(found) : null;
  }

  async listByCustomer(customerId: string): Promise<LicenseKey[]> {
    const out: LicenseKey[] = [];
    for (const license of this.byId.values()) {
      if (license.customerId === customerId) out.push(this.clone(license));
    }
    return out;
  }
}
