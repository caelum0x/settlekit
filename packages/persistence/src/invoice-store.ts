/**
 * Postgres-backed {@link InvoiceStore}. The canonical {@link Invoice} (line
 * items, money, status) lives in `metadata.__doc`; typed columns are projected
 * for querying. `list` filters unpacked docs by the supplied predicate, matching
 * the in-memory store's `customerId`-filter usage.
 */
import { eq, type Database, invoices } from "@settlekit/database";
import type { Invoice, InvoiceStore } from "@settlekit/invoices";
import { packDoc, unpackDoc, unpackDocs } from "./codec.js";

/** Convert an optional ISO timestamp to a Date for a `timestamptz` column. */
function toDate(iso: string | undefined): Date | null {
  return iso ? new Date(iso) : null;
}

export class PgInvoiceStore implements InvoiceStore {
  constructor(private readonly db: Database) {}

  async save(invoice: Invoice): Promise<Invoice> {
    const projection = {
      number: invoice.number,
      organizationId: invoice.organizationId,
      customerId: invoice.customerId,
      status: invoice.status,
      currency: invoice.currency,
      total: invoice.total.amount,
      issuedAt: toDate(invoice.issuedAt),
      dueAt: toDate(invoice.dueAt),
      paidAt: toDate(invoice.paidAt),
      metadata: packDoc(invoice),
    };
    await this.db
      .insert(invoices)
      .values({ id: invoice.id, ...projection })
      .onConflictDoUpdate({ target: invoices.id, set: projection });
    return invoice;
  }

  async findById(id: string): Promise<Invoice | null> {
    const rows = await this.db
      .select({ metadata: invoices.metadata })
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1);
    return unpackDoc<Invoice>(rows[0]);
  }

  async list(predicate?: (invoice: Invoice) => boolean): Promise<Invoice[]> {
    const rows = await this.db.select({ metadata: invoices.metadata }).from(invoices);
    const all = unpackDocs<Invoice>(rows);
    return predicate ? all.filter(predicate) : all;
  }
}
