/**
 * InvoiceService: the application-facing API over an {@link InvoiceStore}.
 *
 * Issues monotonically numbered invoices (per-service sequence), drives the
 * lifecycle transitions, and persists each new immutable invoice. Expected
 * failures (not found, illegal transition) are returned as `Result` errors so
 * the HTTP layer can map them to envelopes without try/catch.
 */
import {
  err,
  notFound,
  ok,
  validationError,
  type Money,
  type Result,
  type SettleKitError,
} from "@settlekit/common";
import type { TaxRate } from "@settlekit/tax";
import {
  addLineItem,
  createInvoice,
  finalizeInvoice,
  invoiceNumber,
  markPaid,
  voidInvoice,
  type CreateInvoiceInput,
  type Invoice,
} from "./invoice.js";
import type { InvoiceLineItem } from "./line-items.js";
import { renderInvoiceHtml, renderInvoiceText, type Merchant } from "./render.js";
import type { InvoiceStore } from "./store.js";

/** Inputs accepted when creating an invoice (number is auto-assigned). */
export interface CreateInvoiceServiceInput {
  organizationId: string;
  customerId: string;
  lineItems?: InvoiceLineItem[];
  currency?: Money["currency"];
  discount?: Money;
  taxRate?: TaxRate;
  dueAt?: string;
  metadata?: Record<string, string>;
}

export interface InvoiceServiceOptions {
  numberPrefix?: string;
}

export class InvoiceService {
  private readonly prefix: string;
  private sequence = 0;

  constructor(
    private readonly store: InvoiceStore,
    options: InvoiceServiceOptions = {},
  ) {
    this.prefix = options.numberPrefix ?? "INV";
  }

  /** Create + persist a new draft invoice with an auto-assigned number. */
  async create(input: CreateInvoiceServiceInput): Promise<Result<Invoice, SettleKitError>> {
    if (input.organizationId.trim().length === 0) {
      return err(validationError("organizationId is required"));
    }
    if (input.customerId.trim().length === 0) {
      return err(validationError("customerId is required"));
    }
    this.sequence += 1;
    const createInput: CreateInvoiceInput = {
      organizationId: input.organizationId,
      customerId: input.customerId,
      number: invoiceNumber(this.prefix, this.sequence),
      ...(input.lineItems !== undefined ? { lineItems: input.lineItems } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.discount !== undefined ? { discount: input.discount } : {}),
      ...(input.taxRate !== undefined ? { taxRate: input.taxRate } : {}),
      ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    };
    return ok(await this.store.save(createInvoice(createInput)));
  }

  /** Fetch an invoice by id. */
  async get(id: string): Promise<Result<Invoice, SettleKitError>> {
    const invoice = await this.store.findById(id);
    if (!invoice) return err(notFound(`Invoice ${id} not found`));
    return ok(invoice);
  }

  /** List invoices, optionally filtered to a single customer. */
  list(customerId?: string): Promise<Invoice[]> {
    return this.store.list(customerId ? (inv) => inv.customerId === customerId : undefined);
  }

  /** Append a line item to a draft invoice (recomputes totals). */
  async addLineItem(
    id: string,
    item: InvoiceLineItem,
    options: { taxRate?: TaxRate } = {},
  ): Promise<Result<Invoice, SettleKitError>> {
    return this.transition(id, (inv) => addLineItem(inv, item, options));
  }

  /** Transition a draft invoice to `open`. */
  finalize(id: string, now?: Date): Promise<Result<Invoice, SettleKitError>> {
    return this.transition(id, (inv) => finalizeInvoice(inv, now ?? new Date()));
  }

  /** Mark an open invoice as paid. */
  markPaid(id: string, now?: Date): Promise<Result<Invoice, SettleKitError>> {
    return this.transition(id, (inv) => markPaid(inv, now ?? new Date()));
  }

  /** Void a draft or open invoice. */
  void(id: string): Promise<Result<Invoice, SettleKitError>> {
    return this.transition(id, (inv) => voidInvoice(inv));
  }

  /** Render an invoice's HTML, or a not-found error. */
  async renderHtml(id: string, merchant: Merchant): Promise<Result<string, SettleKitError>> {
    const found = await this.get(id);
    if (!found.ok) return found;
    return ok(renderInvoiceHtml(found.value, merchant));
  }

  /** Render an invoice's plain text, or a not-found error. */
  async renderText(id: string, merchant: Merchant): Promise<Result<string, SettleKitError>> {
    const found = await this.get(id);
    if (!found.ok) return found;
    return ok(renderInvoiceText(found.value, merchant));
  }

  /** Load, apply a pure transition, persist — mapping throws to Result errors. */
  private async transition(
    id: string,
    apply: (invoice: Invoice) => Invoice,
  ): Promise<Result<Invoice, SettleKitError>> {
    const invoice = await this.store.findById(id);
    if (!invoice) return err(notFound(`Invoice ${id} not found`));
    let next: Invoice;
    try {
      next = apply(invoice);
    } catch (e) {
      return err(validationError(e instanceof Error ? e.message : "Invalid invoice transition"));
    }
    return ok(await this.store.save(next));
  }
}
