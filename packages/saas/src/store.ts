/**
 * Persistence boundaries for the SaaS package + real in-memory implementations.
 *
 * Production code backs {@link PlanStore} / {@link SeatStore} with a real
 * datastore. The in-memory implementations here are fully functional (used by
 * tests and local dev) and preserve immutability by deep-copying on read/write
 * so callers cannot mutate persisted state through retained references.
 */
import { notFound } from "@settlekit/common";
import type { Result, SettleKitError } from "@settlekit/common";
import { ok, err } from "@settlekit/common";
import type { SaasPlan } from "./saas-plan.js";
import type { Seat } from "./seat-limits.js";

/** Storage boundary for SaaS plans. */
export interface PlanStore {
  save(plan: SaasPlan): Promise<SaasPlan>;
  findById(id: string): Promise<SaasPlan | null>;
  list(options?: { productId?: string }): Promise<SaasPlan[]>;
  delete(id: string): Promise<Result<true, SettleKitError>>;
}

/** A persisted seat allocation, scoped to a customer's plan subscription. */
export interface SeatRecord {
  customerId: string;
  seatLimit: number;
  seats: Seat[];
}

/** Storage boundary for per-customer seat allocations. */
export interface SeatStore {
  get(customerId: string): Promise<SeatRecord | null>;
  save(record: SeatRecord): Promise<SeatRecord>;
}

function clonePlan(plan: SaasPlan): SaasPlan {
  return { ...plan, price: { ...plan.price }, features: { ...plan.features } };
}

function cloneSeatRecord(record: SeatRecord): SeatRecord {
  return {
    customerId: record.customerId,
    seatLimit: record.seatLimit,
    seats: record.seats.map((s) => ({ ...s })),
  };
}

/** Real, fully-working in-memory {@link PlanStore}. */
export class InMemoryPlanStore implements PlanStore {
  private readonly plans = new Map<string, SaasPlan>();

  constructor(seed: readonly SaasPlan[] = []) {
    for (const plan of seed) this.plans.set(plan.id, clonePlan(plan));
  }

  async save(plan: SaasPlan): Promise<SaasPlan> {
    const stored = clonePlan(plan);
    this.plans.set(stored.id, stored);
    return clonePlan(stored);
  }

  async findById(id: string): Promise<SaasPlan | null> {
    const found = this.plans.get(id);
    return found ? clonePlan(found) : null;
  }

  async list(options: { productId?: string } = {}): Promise<SaasPlan[]> {
    return [...this.plans.values()]
      .filter((p) => (options.productId ? p.productId === options.productId : true))
      .map(clonePlan)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async delete(id: string): Promise<Result<true, SettleKitError>> {
    if (!this.plans.has(id)) {
      return err(notFound(`Plan ${id} not found`, { id }));
    }
    this.plans.delete(id);
    return ok(true);
  }
}

/** Real, fully-working in-memory {@link SeatStore}. */
export class InMemorySeatStore implements SeatStore {
  private readonly records = new Map<string, SeatRecord>();

  constructor(seed: readonly SeatRecord[] = []) {
    for (const record of seed) this.records.set(record.customerId, cloneSeatRecord(record));
  }

  async get(customerId: string): Promise<SeatRecord | null> {
    const found = this.records.get(customerId);
    return found ? cloneSeatRecord(found) : null;
  }

  async save(record: SeatRecord): Promise<SeatRecord> {
    const stored = cloneSeatRecord(record);
    this.records.set(stored.customerId, stored);
    return cloneSeatRecord(stored);
  }
}
