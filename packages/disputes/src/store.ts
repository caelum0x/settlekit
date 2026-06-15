import type { Dispute } from "./types.js";

/** Persistence boundary for disputes. Records are stored immutably. */
export interface DisputeStore {
  save(dispute: Dispute): Promise<Dispute>;
  findById(id: string): Promise<Dispute | undefined>;
  listByPayment(paymentId: string): Promise<Dispute[]>;
  listByCustomer(customerId: string): Promise<Dispute[]>;
  listOpen(): Promise<Dispute[]>;
  listAll(): Promise<Dispute[]>;
}

/** In-memory DisputeStore for tests, local dev, and as a reference impl. */
export class InMemoryDisputeStore implements DisputeStore {
  private readonly disputes = new Map<string, Dispute>();

  async save(dispute: Dispute): Promise<Dispute> {
    const stored = clone(dispute);
    this.disputes.set(stored.id, stored);
    return clone(stored);
  }

  async findById(id: string): Promise<Dispute | undefined> {
    const found = this.disputes.get(id);
    return found ? clone(found) : undefined;
  }

  async listByPayment(paymentId: string): Promise<Dispute[]> {
    return this.snapshot().filter((d) => d.paymentId === paymentId);
  }

  async listByCustomer(customerId: string): Promise<Dispute[]> {
    return this.snapshot().filter((d) => d.customerId === customerId);
  }

  async listOpen(): Promise<Dispute[]> {
    return this.snapshot().filter((d) => d.status === "open" || d.status === "under_review");
  }

  async listAll(): Promise<Dispute[]> {
    return this.snapshot();
  }

  private snapshot(): Dispute[] {
    return Array.from(this.disputes.values(), clone);
  }
}

function clone(dispute: Dispute): Dispute {
  return { ...dispute, evidence: dispute.evidence.map((e) => ({ ...e })) };
}
