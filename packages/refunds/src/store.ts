import type { Refund } from "./types.js";

/**
 * Persistence boundary for refunds. Implementations must treat stored records
 * as immutable: `save` overwrites by id, never mutates a returned object.
 */
export interface RefundStore {
  save(refund: Refund): Promise<Refund>;
  findById(id: string): Promise<Refund | undefined>;
  listByPayment(paymentId: string): Promise<Refund[]>;
  listByCustomer(customerId: string): Promise<Refund[]>;
  listAll(): Promise<Refund[]>;
}

/** In-memory RefundStore for tests, local dev, and as a reference impl. */
export class InMemoryRefundStore implements RefundStore {
  private readonly refunds = new Map<string, Refund>();

  async save(refund: Refund): Promise<Refund> {
    const stored: Refund = { ...refund };
    this.refunds.set(stored.id, stored);
    return { ...stored };
  }

  async findById(id: string): Promise<Refund | undefined> {
    const found = this.refunds.get(id);
    return found ? { ...found } : undefined;
  }

  async listByPayment(paymentId: string): Promise<Refund[]> {
    return this.snapshot().filter((r) => r.paymentId === paymentId);
  }

  async listByCustomer(customerId: string): Promise<Refund[]> {
    return this.snapshot().filter((r) => r.customerId === customerId);
  }

  async listAll(): Promise<Refund[]> {
    return this.snapshot();
  }

  private snapshot(): Refund[] {
    return Array.from(this.refunds.values(), (r) => ({ ...r }));
  }
}
