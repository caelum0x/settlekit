/**
 * Receipt rendering + access-granted ("delivery instruction") emails.
 *
 * These are pure functions: given domain objects, produce HTML/text strings.
 * Amounts are formatted via the common Money model (no floating point).
 */

import type { Money, Payment, Merchant, Customer, Entitlement, EntitlementType } from "@settlekit/common";
import { addMoney, money } from "@settlekit/common";
import { escapeHtml, formatUsdc, htmlLayout, htmlRow, textBlock, textLine } from "./templates.js";

/** A single purchased line on a receipt. */
export interface ReceiptLineItem {
  description: string;
  quantity: number;
  /** Per-unit price. The row total is unitPrice * quantity. */
  unitPrice: Money;
}

/** Sum all line items (quantity * unitPrice). Empty list yields zero USDC. */
export function sumLineItems(lineItems: ReadonlyArray<ReceiptLineItem>): Money {
  return lineItems.reduce<Money>((acc, item) => {
    const lineTotal = multiplyLine(item.unitPrice, item.quantity);
    return addMoney(acc, lineTotal);
  }, money("0"));
}

function multiplyLine(unitPrice: Money, quantity: number): Money {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new RangeError(`quantity must be a non-negative integer, got ${quantity}`);
  }
  let total = money("0", unitPrice.currency);
  for (let i = 0; i < quantity; i += 1) {
    total = addMoney(total, unitPrice);
  }
  return total;
}

/** Render an HTML receipt for a confirmed payment. */
export function renderReceiptHtml(
  payment: Payment,
  lineItems: ReadonlyArray<ReceiptLineItem>,
  merchant: Merchant,
): string {
  const total = payment.amount;
  const itemRows = lineItems
    .map((item) => {
      const lineTotal = multiplyLine(item.unitPrice, item.quantity);
      const label = `${item.description} × ${item.quantity}`;
      return htmlRow(label, formatUsdc(lineTotal.amount, lineTotal.currency));
    })
    .join("");

  const paidAt = payment.confirmedAt ?? payment.createdAt;

  const body = [
    `<h1 style="font-size:20px;margin:0 0 4px">Receipt from ${escapeHtml(merchant.displayName)}</h1>`,
    `<p style="color:#71717a;font-size:14px;margin:0 0 24px">Payment ${escapeHtml(payment.id)}</p>`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">',
    itemRows,
    '<tr><td colspan="2" style="border-top:1px solid #e4e4e7;padding-top:8px"></td></tr>',
    "<tr>" +
      '<td style="padding:6px 0;font-weight:bold;font-size:15px">Total</td>' +
      `<td style="padding:6px 0;text-align:right;font-weight:bold;font-size:15px">${escapeHtml(
        formatUsdc(total.amount, total.currency),
      )}</td>` +
      "</tr>",
    "</table>",
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px">',
    htmlRow("Network", payment.network),
    payment.txHash ? htmlRow("Transaction", payment.txHash) : "",
    htmlRow("Status", payment.status),
    htmlRow("Date", paidAt),
    "</table>",
  ].join("\n");

  const footer = merchant.supportEmail
    ? `Questions? Contact ${merchant.supportEmail}.`
    : "Thank you for your purchase.";

  return htmlLayout({ title: `Receipt from ${merchant.displayName}`, body, footer });
}

/** Render a plaintext receipt for a confirmed payment. */
export function renderReceiptText(
  payment: Payment,
  lineItems: ReadonlyArray<ReceiptLineItem>,
  merchant: Merchant,
): string {
  const total = payment.amount;
  const paidAt = payment.confirmedAt ?? payment.createdAt;

  const itemLines = lineItems.map((item) => {
    const lineTotal = multiplyLine(item.unitPrice, item.quantity);
    return `  ${item.description} x ${item.quantity}  ${formatUsdc(lineTotal.amount, lineTotal.currency)}`;
  });

  const sections = [
    `Receipt from ${merchant.displayName}`,
    `Payment ${payment.id}`,
    ["Items:", ...itemLines].join("\n"),
    textLine("Total", formatUsdc(total.amount, total.currency)),
    [
      textLine("Network", payment.network),
      payment.txHash ? textLine("Transaction", payment.txHash) : "",
      textLine("Status", payment.status),
      textLine("Date", paidAt),
    ]
      .filter((l) => l.length > 0)
      .join("\n"),
    merchant.supportEmail ? `Questions? Contact ${merchant.supportEmail}.` : "Thank you for your purchase.",
  ];

  return textBlock(sections);
}

/**
 * A concrete instruction telling the buyer how to access something they bought.
 * Built from an Entitlement plus the resolved access detail.
 */
export interface AccessInstruction {
  entitlementType: EntitlementType;
  /** Human label, e.g. "GitHub repository access". */
  title: string;
  /** One-line description of what was granted. */
  description: string;
  /** Optional actionable URL (invite link, download link, discord invite). */
  url?: string;
  /** Optional secret value to surface once (license key, api key). */
  secret?: string;
}

export interface AccessGrantedArgs {
  customer: Customer;
  entitlements: ReadonlyArray<{ entitlement: Entitlement; instruction: AccessInstruction }>;
  /** Optional merchant for branding/footer. */
  merchant?: Merchant;
}

function instructionHtml(item: AccessInstruction): string {
  const parts = [
    `<h3 style="font-size:15px;margin:16px 0 4px">${escapeHtml(item.title)}</h3>`,
    `<p style="margin:0 0 4px;font-size:14px;color:#3f3f46">${escapeHtml(item.description)}</p>`,
  ];
  if (item.url) {
    parts.push(
      `<p style="margin:0 0 4px;font-size:14px"><a href="${escapeHtml(item.url)}" ` +
        'style="color:#2563eb">' +
        `${escapeHtml(item.url)}</a></p>`,
    );
  }
  if (item.secret) {
    parts.push(
      '<pre style="background:#f4f4f5;border-radius:6px;padding:10px;font-size:13px;' +
        `overflow:auto;margin:0 0 4px">${escapeHtml(item.secret)}</pre>`,
    );
  }
  return parts.join("\n");
}

/** Render the HTML "access granted" delivery-instruction email. */
export function renderAccessGrantedEmail(args: AccessGrantedArgs): string {
  const greeting = args.customer.name ? `Hi ${args.customer.name},` : "Hi,";
  const blocks = args.entitlements.map(({ instruction }) => instructionHtml(instruction)).join("\n");

  const body = [
    '<h1 style="font-size:20px;margin:0 0 4px">Your access is ready</h1>',
    `<p style="font-size:14px;color:#3f3f46;margin:0 0 16px">${escapeHtml(greeting)} ` +
      "here is everything you just unlocked.</p>",
    blocks,
  ].join("\n");

  const footer = args.merchant?.supportEmail
    ? `Need help? Contact ${args.merchant.supportEmail}.`
    : "If a link does not work, reply to this email.";

  return htmlLayout({ title: "Your access is ready", body, footer });
}

/** Render the plaintext "access granted" delivery-instruction email. */
export function renderAccessGrantedText(args: AccessGrantedArgs): string {
  const greeting = args.customer.name ? `Hi ${args.customer.name},` : "Hi,";

  const blocks = args.entitlements.map(({ instruction }) => {
    const lines = [`* ${instruction.title}`, `  ${instruction.description}`];
    if (instruction.url) lines.push(`  Link: ${instruction.url}`);
    if (instruction.secret) lines.push(`  ${instruction.secret}`);
    return lines.join("\n");
  });

  const footer = args.merchant?.supportEmail
    ? `Need help? Contact ${args.merchant.supportEmail}.`
    : "If a link does not work, reply to this email.";

  return textBlock([`${greeting} here is everything you just unlocked.`, blocks.join("\n\n"), footer]);
}
