/**
 * Invoice domain model + lifecycle transitions.
 *
 * Money math (subtotal, discount, tax, total) is exact (bigint base units via
 * `@settlekit/common`). Tax, when requested, is computed with `@settlekit/tax`
 * `calculateTax`. Every transition (add line item, finalize, mark paid, void)
 * returns a NEW immutable invoice — inputs are never mutated.
 */
import {
  addMoney,
  generateSecret,
  money,
  subtractMoney,
  toIso,
  type IsoTimestamp,
  type Money,
} from "@settlekit/common";
import { calculateTax, type TaxRate } from "@settlekit/tax";
import { computeSubtotal, type InvoiceLineItem } from "./line-items.js";

export type InvoiceStatus = "draft" | "open" | "paid" | "void" | "uncollectible";

/** A customer invoice. Immutable — transitions produce new copies. */
export interface Invoice {
  id: string;
  number: string;
  organizationId: string;
  customerId: string;
  lineItems: InvoiceLineItem[];
  subtotal: Money;
  discount?: Money;
  tax?: Money;
  total: Money;
  currency: Money["currency"];
  status: InvoiceStatus;
  issuedAt?: IsoTimestamp;
  dueAt?: IsoTimestamp;
  paidAt?: IsoTimestamp;
  metadata: Record<string, string>;
}

/** Inputs for creating a draft invoice. */
export interface CreateInvoiceInput {
  organizationId: string;
  customerId: string;
  number: string;
  lineItems?: InvoiceLineItem[];
  currency?: Money["currency"];
  discount?: Money;
  taxRate?: TaxRate;
  dueAt?: IsoTimestamp;
  metadata?: Record<string, string>;
}

/** Format a zero-padded, prefixed invoice number, e.g. `INV-000042`. */
export function invoiceNumber(prefix: string, sequence: number): string {
  return `${prefix}-${sequence.toString().padStart(6, "0")}`;
}

/**
 * Recompute subtotal/tax/total for a set of line items, applying an optional
 * fixed discount (subtracted from subtotal before tax) and an optional tax rate.
 * Pure: returns the three derived Money values.
 */
export function computeTotals(
  lineItems: readonly InvoiceLineItem[],
  currency: Money["currency"],
  options: { discount?: Money; taxRate?: TaxRate } = {},
): { subtotal: Money; taxable: Money; tax?: Money; total: Money } {
  const subtotal = computeSubtotal(lineItems, currency);
  const taxable = options.discount ? subtractMoney(subtotal, options.discount) : subtotal;
  if (options.taxRate) {
    const calc = calculateTax(taxable, options.taxRate);
    return { subtotal, taxable, tax: calc.tax, total: calc.total };
  }
  return { subtotal, taxable, total: taxable };
}

/** Create a new draft invoice with computed totals. */
export function createInvoice(input: CreateInvoiceInput): Invoice {
  const currency = input.currency ?? "USDC";
  const lineItems = input.lineItems ?? [];
  const totals = computeTotals(lineItems, currency, {
    ...(input.discount !== undefined ? { discount: input.discount } : {}),
    ...(input.taxRate !== undefined ? { taxRate: input.taxRate } : {}),
  });
  return {
    id: `inv_${generateSecret(12)}`,
    number: input.number,
    organizationId: input.organizationId,
    customerId: input.customerId,
    lineItems: [...lineItems],
    subtotal: totals.subtotal,
    ...(input.discount !== undefined ? { discount: input.discount } : {}),
    ...(totals.tax !== undefined ? { tax: totals.tax } : {}),
    total: totals.total,
    currency,
    status: "draft",
    ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
    metadata: input.metadata ? { ...input.metadata } : {},
  };
}

/**
 * Append a line item to a DRAFT invoice and recompute totals. Throws if the
 * invoice is no longer a draft. Returns a new invoice.
 */
export function addLineItem(
  invoice: Invoice,
  item: InvoiceLineItem,
  options: { taxRate?: TaxRate } = {},
): Invoice {
  if (invoice.status !== "draft") {
    throw new Error(`Cannot add line items to a ${invoice.status} invoice`);
  }
  const lineItems = [...invoice.lineItems, item];
  const totals = computeTotals(lineItems, invoice.currency, {
    ...(invoice.discount !== undefined ? { discount: invoice.discount } : {}),
    ...(options.taxRate !== undefined ? { taxRate: options.taxRate } : {}),
  });
  const next: Invoice = {
    ...invoice,
    lineItems,
    subtotal: totals.subtotal,
    total: totals.total,
  };
  if (totals.tax !== undefined) return { ...next, tax: totals.tax };
  return next;
}

/** Transition a draft invoice to `open`, stamping `issuedAt`. */
export function finalizeInvoice(invoice: Invoice, now: Date = new Date()): Invoice {
  if (invoice.status !== "draft") {
    throw new Error(`Only draft invoices can be finalized (was ${invoice.status})`);
  }
  return { ...invoice, status: "open", issuedAt: toIso(now) };
}

/** Mark an open invoice as paid, stamping `paidAt`. */
export function markPaid(invoice: Invoice, now: Date = new Date()): Invoice {
  if (invoice.status !== "open") {
    throw new Error(`Only open invoices can be marked paid (was ${invoice.status})`);
  }
  return { ...invoice, status: "paid", paidAt: toIso(now) };
}

/** Void a draft or open invoice. Paid invoices cannot be voided. */
export function voidInvoice(invoice: Invoice): Invoice {
  if (invoice.status === "paid") {
    throw new Error("Paid invoices cannot be voided");
  }
  if (invoice.status === "void") return invoice;
  return { ...invoice, status: "void" };
}

/** The outstanding amount on an invoice (total when unpaid, zero when paid). */
export function amountDue(invoice: Invoice): Money {
  if (invoice.status === "paid" || invoice.status === "void") {
    return money("0", invoice.currency);
  }
  return invoice.total;
}

/** Convenience: subtotal of an invoice's current line items. */
export function recomputeSubtotal(invoice: Invoice): Money {
  return computeSubtotal(invoice.lineItems, invoice.currency);
}

/** Re-export for callers building totals manually. */
export { addMoney };
