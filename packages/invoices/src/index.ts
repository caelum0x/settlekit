/**
 * @settlekit/invoices — real invoicing engine.
 *
 * Public API: the {@link Invoice} model + lifecycle transitions
 * ({@link createInvoice}, {@link addLineItem}, {@link finalizeInvoice},
 * {@link markPaid}, {@link voidInvoice}), exact line-item math, HTML/text
 * rendering, the {@link InvoiceStore} abstraction with a real
 * {@link InMemoryInvoiceStore}, and the {@link InvoiceService} facade.
 */
export type {
  Invoice,
  InvoiceStatus,
  CreateInvoiceInput,
} from "./invoice.js";
export {
  createInvoice,
  addLineItem,
  finalizeInvoice,
  markPaid,
  voidInvoice,
  invoiceNumber,
  computeTotals,
  amountDue,
  recomputeSubtotal,
} from "./invoice.js";

export type { InvoiceLineItem } from "./line-items.js";
export { lineItemAmount, computeSubtotal } from "./line-items.js";

export type { Merchant } from "./render.js";
export { renderInvoiceHtml, renderInvoiceText } from "./render.js";

export type { InvoiceStore } from "./store.js";
export { InMemoryInvoiceStore } from "./store.js";

export type { CreateInvoiceServiceInput, InvoiceServiceOptions } from "./service.js";
export { InvoiceService } from "./service.js";
