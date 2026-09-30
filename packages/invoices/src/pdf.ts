/**
 * Invoice and receipt PDFs, rendered with foliojs/pdfkit (MIT).
 *
 * The same layout serves an issued invoice (with a pay link) and a paid
 * receipt (with the settlement transaction). Only the built-in Helvetica font
 * is used, so no font files ship with the package.
 */
import PDFDocument from "pdfkit";
import type { Money } from "@settlekit/common";
import { lineItemAmount } from "./line-items.js";
import type { Invoice } from "./invoice.js";
import type { Merchant } from "./render.js";

/** Tax identity printed on tax-grade documents. */
export interface TaxParty {
  /** Legal or display name. */
  name?: string;
  /** VAT / GST / sales-tax registration number. */
  taxId?: string;
  /** ISO 3166-1 alpha-2 country code. */
  country?: string;
  addressLines?: string[];
}

export interface InvoicePdfOptions {
  /** Document title; defaults to "Receipt" for paid invoices, else "Invoice". */
  title?: string;
  /** Public pay link printed on unpaid invoices. */
  payUrl?: string;
  /** Seller tax identity (tax ID shown under the merchant block). */
  seller?: TaxParty;
  /** Buyer identity (bill-to block). */
  buyer?: TaxParty & { email?: string };
  /** Tax jurisdiction label for the tax row, e.g. "DE VAT 19%". */
  taxLabel?: string;
  /** Disable stream compression (tests read the text back). Default true. */
  compress?: boolean;
  /** Creation date stamped into the PDF info dictionary (determinism). */
  creationDate?: Date;
}

function fmtMoney(m: Money): string {
  return `${m.amount} ${m.currency}`;
}

function fmtDate(iso?: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

/** PDFKit's Helvetica is WinAnsi: replace anything it cannot draw. */
function safe(text: string): string {
  return text.replace(/[^\x20-\x7E -ÿ]/g, "?");
}

function partyLines(party: (TaxParty & { email?: string }) | undefined): string[] {
  if (!party) return [];
  return [
    ...(party.name ? [party.name] : []),
    ...(party.addressLines ?? []),
    ...(party.country ? [`Country: ${party.country}`] : []),
    ...(party.taxId ? [`Tax ID: ${party.taxId}`] : []),
    ...(party.email ? [party.email] : []),
  ];
}

/** Render an invoice (or, when paid, a receipt) to a PDF buffer. */
export function renderInvoicePdf(
  invoice: Invoice,
  merchant: Merchant,
  options: InvoicePdfOptions = {},
): Promise<Buffer> {
  const title = options.title ?? (invoice.status === "paid" ? "Receipt" : "Invoice");
  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    compress: options.compress ?? true,
    info: {
      Title: `${title} ${invoice.number}`,
      Author: merchant.name,
      ...(options.creationDate ? { CreationDate: options.creationDate } : {}),
    },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const write = (text: string, opts?: PDFKit.Mixins.TextOptions) => doc.text(safe(text), opts);

  doc.font("Helvetica-Bold").fontSize(20);
  write(`${title} ${invoice.number}`);
  doc.moveDown(0.5).font("Helvetica").fontSize(10);
  write(`Status: ${invoice.status}`);
  write(`Issued: ${fmtDate(invoice.issuedAt)}`);
  if (invoice.dueAt) write(`Due: ${fmtDate(invoice.dueAt)}`);
  if (invoice.paidAt) write(`Paid: ${fmtDate(invoice.paidAt)}`);

  doc.moveDown().font("Helvetica-Bold");
  write("From");
  doc.font("Helvetica");
  const sellerLines = [
    merchant.name,
    ...(merchant.addressLines ?? []),
    ...(merchant.email ? [merchant.email] : []),
    ...(merchant.website ? [merchant.website] : []),
    ...partyLines(options.seller ? { ...options.seller, name: undefined } : undefined),
  ];
  for (const line of sellerLines) write(line);

  const buyerLines = partyLines(options.buyer);
  doc.moveDown().font("Helvetica-Bold");
  write("Bill to");
  doc.font("Helvetica");
  for (const line of buyerLines.length > 0 ? buyerLines : [invoice.customerId]) write(line);

  doc.moveDown();
  const left = doc.page.margins.left;
  const cols = { desc: left, qty: left + 260, unit: left + 300, amount: left + 400 };
  const row = (cells: [string, string, string, string]) => {
    const y = doc.y;
    doc.text(safe(cells[0]), cols.desc, y, { width: 250 });
    const after = doc.y;
    doc.text(safe(cells[1]), cols.qty, y, { width: 35, align: "right" });
    doc.text(safe(cells[2]), cols.unit, y, { width: 95, align: "right" });
    doc.text(safe(cells[3]), cols.amount, y, { width: 95, align: "right" });
    doc.x = left;
    doc.y = Math.max(after, doc.y);
  };
  doc.font("Helvetica-Bold");
  row(["Description", "Qty", "Unit", "Amount"]);
  doc.font("Helvetica");
  for (const item of invoice.lineItems) {
    row([item.description, String(item.quantity), fmtMoney(item.unitAmount), fmtMoney(lineItemAmount(item))]);
  }

  doc.moveDown();
  write(`Subtotal: ${fmtMoney(invoice.subtotal)}`, { align: "right" });
  if (invoice.discount) write(`Discount: -${fmtMoney(invoice.discount)}`, { align: "right" });
  if (invoice.tax) write(`${options.taxLabel ?? "Tax"}: ${fmtMoney(invoice.tax)}`, { align: "right" });
  doc.font("Helvetica-Bold");
  write(`Total: ${fmtMoney(invoice.total)}`, { align: "right" });
  doc.font("Helvetica");

  const paidTx = invoice.metadata.paidTxHash;
  if (invoice.status === "paid" && paidTx) {
    doc.moveDown();
    write(`Settled on ${invoice.metadata.paidNetwork ?? "chain"} in transaction ${paidTx}`);
  } else if (options.payUrl && invoice.status === "open") {
    doc.moveDown();
    write(`Pay online: ${options.payUrl}`, { link: options.payUrl, underline: true });
  }

  doc.end();
  return done;
}
