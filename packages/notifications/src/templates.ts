/**
 * Shared rendering primitives for HTML/text emails.
 *
 * Kept dependency-free and pure so domain templates are trivially testable.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape a value for safe interpolation into HTML text/attribute content. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** Format a USDC Money-style amount string for human display, e.g. "$25.50 USDC". */
export function formatUsdc(amount: string, currency: string): string {
  // amount is already a normalized decimal string from common Money.
  const [whole, frac = ""] = amount.replace(/^-/, "").split(".");
  const sign = amount.startsWith("-") ? "-" : "";
  const grouped = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fracDisplay = frac.length >= 2 ? frac.slice(0, 2) : (frac + "00").slice(0, 2);
  return `${sign}$${grouped}.${fracDisplay} ${currency}`;
}

export interface LayoutOptions {
  title: string;
  /** Inner HTML body (already escaped where needed). */
  body: string;
  /** Optional footer note. */
  footer?: string;
}

/**
 * Wrap inner content in a minimal, email-client-safe HTML document.
 * Uses inline styles + table layout for broad client compatibility.
 */
export function htmlLayout(options: LayoutOptions): string {
  const footer = options.footer
    ? `<p style="color:#888;font-size:12px;margin-top:24px">${escapeHtml(options.footer)}</p>`
    : "";
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(options.title)}</title>`,
    "</head>",
    '<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5">',
    "<tr><td align=\"center\" style=\"padding:24px 12px\">",
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;padding:32px;max-width:600px">',
    "<tr><td>",
    options.body,
    footer,
    "</td></tr>",
    "</table>",
    "</td></tr>",
    "</table>",
    "</body>",
    "</html>",
  ].join("\n");
}

/** A single key/value row rendered as an HTML table row. */
export function htmlRow(label: string, value: string): string {
  return (
    "<tr>" +
    `<td style="padding:6px 0;color:#71717a;font-size:14px">${escapeHtml(label)}</td>` +
    `<td style="padding:6px 0;text-align:right;font-size:14px;color:#18181b">${escapeHtml(value)}</td>` +
    "</tr>"
  );
}

/** Render a labelled line for plaintext emails, e.g. "Amount: $25.50 USDC". */
export function textLine(label: string, value: string): string {
  return `${label}: ${value}`;
}

/** Join non-empty plaintext sections with blank lines between them. */
export function textBlock(sections: ReadonlyArray<string>): string {
  return sections.filter((s) => s.length > 0).join("\n\n");
}
