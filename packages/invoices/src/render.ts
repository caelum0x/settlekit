/**
 * Invoice rendering: a real, self-contained styled HTML document and a plain
 * text representation. No templating engine — just safe string building with
 * HTML escaping of every interpolated value.
 */
import type { Money } from "@settlekit/common";
import { lineItemAmount } from "./line-items.js";
import type { Invoice } from "./invoice.js";

/** Merchant details shown in the invoice header. */
export interface Merchant {
  name: string;
  email?: string;
  addressLines?: string[];
  website?: string;
}

const STATUS_LABEL: Record<Invoice["status"], string> = {
  draft: "Draft",
  open: "Open",
  paid: "Paid",
  void: "Void",
  uncollectible: "Uncollectible",
};

/** Escape a string for safe interpolation into HTML text/attribute content. */
function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmtMoney(m: Money): string {
  return `${m.amount} ${m.currency}`;
}

function fmtDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** Render an invoice as a complete, styled, standalone HTML document. */
export function renderInvoiceHtml(invoice: Invoice, merchant: Merchant): string {
  const rows = invoice.lineItems
    .map(
      (item) => `
        <tr>
          <td>${esc(item.description)}</td>
          <td class="num">${item.quantity}</td>
          <td class="num">${fmtMoney(item.unitAmount)}</td>
          <td class="num">${fmtMoney(lineItemAmount(item))}</td>
        </tr>`,
    )
    .join("");

  const merchantAddress = (merchant.addressLines ?? [])
    .map((line) => `<div>${esc(line)}</div>`)
    .join("");

  const discountRow = invoice.discount
    ? `<tr><td class="label">Discount</td><td class="num">-${fmtMoney(invoice.discount)}</td></tr>`
    : "";
  const taxRow = invoice.tax
    ? `<tr><td class="label">Tax</td><td class="num">${fmtMoney(invoice.tax)}</td></tr>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Invoice ${esc(invoice.number)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 40px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1a1a2e; background: #f5f6fa; }
    .invoice { max-width: 720px; margin: 0 auto; background: #fff; border: 1px solid #e4e6ef; border-radius: 12px; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
    .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 32px; }
    .merchant-name { font-size: 20px; font-weight: 700; margin: 0 0 6px; }
    .muted { color: #6b7280; font-size: 13px; line-height: 1.5; }
    .invoice-meta { text-align: right; }
    .invoice-title { font-size: 28px; font-weight: 800; margin: 0 0 8px; letter-spacing: -.5px; }
    .status { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .status.paid { background: #e6f7ed; color: #137a47; }
    .status.open { background: #fff4e5; color: #a85b00; }
    .status.draft { background: #eef0f5; color: #4b5563; }
    .status.void, .status.uncollectible { background: #fde8e8; color: #b42318; }
    .bill-to { margin-bottom: 28px; }
    .bill-to h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; margin: 0 0 6px; }
    table { width: 100%; border-collapse: collapse; }
    .items th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; border-bottom: 2px solid #e4e6ef; padding: 10px 8px; }
    .items td { padding: 12px 8px; border-bottom: 1px solid #eef0f5; font-size: 14px; }
    .items .num, th.num { text-align: right; }
    .totals { margin-top: 20px; margin-left: auto; width: 280px; }
    .totals td { padding: 8px; font-size: 14px; }
    .totals .label { color: #6b7280; }
    .totals .num { text-align: right; }
    .totals .grand td { border-top: 2px solid #e4e6ef; font-weight: 800; font-size: 16px; padding-top: 12px; }
    .footer { margin-top: 36px; padding-top: 20px; border-top: 1px solid #eef0f5; font-size: 12px; color: #9aa1ad; }
  </style>
</head>
<body>
  <div class="invoice">
    <div class="top">
      <div>
        <p class="merchant-name">${esc(merchant.name)}</p>
        <div class="muted">
          ${merchantAddress}
          ${merchant.email ? `<div>${esc(merchant.email)}</div>` : ""}
          ${merchant.website ? `<div>${esc(merchant.website)}</div>` : ""}
        </div>
      </div>
      <div class="invoice-meta">
        <p class="invoice-title">Invoice</p>
        <div class="muted">
          <div><strong>${esc(invoice.number)}</strong></div>
          <div>Issued ${fmtDate(invoice.issuedAt)}</div>
          <div>Due ${fmtDate(invoice.dueAt)}</div>
          <div style="margin-top:8px;"><span class="status ${invoice.status}">${STATUS_LABEL[invoice.status]}</span></div>
        </div>
      </div>
    </div>

    <div class="bill-to">
      <h3>Bill to</h3>
      <div class="muted"><div>Customer ${esc(invoice.customerId)}</div></div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th>Description</th>
          <th class="num">Qty</th>
          <th class="num">Unit</th>
          <th class="num">Amount</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="4" class="muted">No line items.</td></tr>`}</tbody>
    </table>

    <table class="totals">
      <tr><td class="label">Subtotal</td><td class="num">${fmtMoney(invoice.subtotal)}</td></tr>
      ${discountRow}
      ${taxRow}
      <tr class="grand"><td>Total</td><td class="num">${fmtMoney(invoice.total)}</td></tr>
    </table>

    <div class="footer">
      Invoice ${esc(invoice.id)} · ${esc(merchant.name)}${merchant.email ? ` · ${esc(merchant.email)}` : ""}
    </div>
  </div>
</body>
</html>`;
}

/** Render an invoice as a plain-text representation (e.g. for email bodies). */
export function renderInvoiceText(invoice: Invoice, merchant: Merchant): string {
  const lines: string[] = [];
  lines.push(`INVOICE ${invoice.number}`);
  lines.push(merchant.name);
  if (merchant.email) lines.push(merchant.email);
  lines.push("");
  lines.push(`Status:   ${STATUS_LABEL[invoice.status]}`);
  lines.push(`Issued:   ${fmtDate(invoice.issuedAt)}`);
  lines.push(`Due:      ${fmtDate(invoice.dueAt)}`);
  lines.push(`Customer: ${invoice.customerId}`);
  lines.push("");
  lines.push("Items:");
  for (const item of invoice.lineItems) {
    lines.push(
      `  ${item.description} — ${item.quantity} x ${fmtMoney(item.unitAmount)} = ${fmtMoney(lineItemAmount(item))}`,
    );
  }
  if (invoice.lineItems.length === 0) lines.push("  (none)");
  lines.push("");
  lines.push(`Subtotal: ${fmtMoney(invoice.subtotal)}`);
  if (invoice.discount) lines.push(`Discount: -${fmtMoney(invoice.discount)}`);
  if (invoice.tax) lines.push(`Tax:      ${fmtMoney(invoice.tax)}`);
  lines.push(`Total:    ${fmtMoney(invoice.total)}`);
  return lines.join("\n");
}
