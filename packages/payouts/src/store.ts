import type { Payout } from "./types.js";

/** Persistence boundary for payouts. Records are stored immutably. */
export interface PayoutStore {
  save(payout: Payout): Promise<Payout>;
  findById(id: string): Promise<Payout | undefined>;
  listByOrganization(organizationId: string): Promise<Payout[]>;
  listAll(): Promise<Payout[]>;
}

/** In-memory PayoutStore for tests, local dev, and as a reference impl. */
export class InMemoryPayoutStore implements PayoutStore {
  private readonly payouts = new Map<string, Payout>();

  async save(payout: Payout): Promise<Payout> {
    const stored: Payout = { ...payout };
    this.payouts.set(stored.id, stored);
    return { ...stored };
  }

  async findById(id: string): Promise<Payout | undefined> {
    const found = this.payouts.get(id);
    return found ? { ...found } : undefined;
  }

  async listByOrganization(organizationId: string): Promise<Payout[]> {
    return this.snapshot().filter((p) => p.organizationId === organizationId);
  }

  async listAll(): Promise<Payout[]> {
    return this.snapshot();
  }

  private snapshot(): Payout[] {
    return Array.from(this.payouts.values(), (p) => ({ ...p }));
  }
}
