/**
 * Invoice persistence abstraction + a real in-memory implementation.
 *
 * Invoices are stored by id; listing supports an optional predicate (used for
 * `customerId` filtering). All records are JSON-cloned in/out so stored state
 * never aliases caller objects.
 */
import type { Invoice } from "./invoice.js";

/** Storage operations the invoice service depends on. */
export interface InvoiceStore {
  save(invoice: Invoice): Promise<Invoice>;
  findById(id: string): Promise<Invoice | null>;
  list(predicate?: (invoice: Invoice) => boolean): Promise<Invoice[]>;
}

/** Deep clone via JSON round-trip — invoices are plain JSON-serializable data. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A real in-memory {@link InvoiceStore} — fully working, not a mock. */
export class InMemoryInvoiceStore implements InvoiceStore {
  private readonly byId = new Map<string, Invoice>();

  async save(invoice: Invoice): Promise<Invoice> {
    const stored = clone(invoice);
    this.byId.set(stored.id, stored);
    return clone(stored);
  }

  async findById(id: string): Promise<Invoice | null> {
    const found = this.byId.get(id);
    return found ? clone(found) : null;
  }

  async list(predicate?: (invoice: Invoice) => boolean): Promise<Invoice[]> {
    const all = [...this.byId.values()].map(clone);
    return predicate ? all.filter(predicate) : all;
  }
}
