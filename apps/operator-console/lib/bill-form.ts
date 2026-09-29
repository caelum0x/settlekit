/** Validation for the console's add-bill form (manual entry or pasted invoice). */
import type { BillInput } from "./api-client";
import type { FieldErrors, ParseResult } from "./onboarding";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const USDC_RE = /^\d{1,12}(\.\d{1,6})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_INVOICE_CHARS = 50_000;

const text = (form: Readonly<Record<string, unknown>>, key: string): string => {
  const v = form[key];
  return typeof v === "string" ? v.trim() : "";
};

export function parseBillForm(form: Readonly<Record<string, unknown>>): ParseResult<BillInput> {
  const mode = text(form, "mode");
  if (mode === "invoice") {
    const invoiceText = text(form, "invoiceText");
    if (invoiceText.length === 0) return { ok: false, errors: { invoiceText: "Paste the invoice text." } };
    if (invoiceText.length > MAX_INVOICE_CHARS) return { ok: false, errors: { invoiceText: `Invoice text is limited to ${MAX_INVOICE_CHARS} characters.` } };
    return { ok: true, value: { invoiceText } };
  }
  const errors: Record<string, string> = {};
  const payee = text(form, "payee");
  const amountUsdc = text(form, "amountUsdc");
  const dueDate = text(form, "dueDate");
  const description = text(form, "description");
  const vendor = text(form, "vendor");
  if (!ADDRESS_RE.test(payee)) errors.payee = "Payee must be a 0x wallet address.";
  if (!USDC_RE.test(amountUsdc) || /^0+(\.0+)?$/.test(amountUsdc)) errors.amountUsdc = "Enter a positive USDC amount.";
  if (!DATE_RE.test(dueDate) || Number.isNaN(Date.parse(`${dueDate}T00:00:00Z`))) errors.dueDate = "Enter a due date (YYYY-MM-DD).";
  if (description.length === 0 || description.length > 500) errors.description = "Describe the bill (up to 500 characters).";
  if (vendor.length > 200) errors.vendor = "Vendor name is limited to 200 characters.";
  if (Object.keys(errors).length > 0) return { ok: false, errors: errors as FieldErrors };
  return {
    ok: true,
    value: {
      payee,
      amountUsdc,
      dueAt: new Date(`${dueDate}T00:00:00Z`).toISOString(),
      description,
      ...(vendor ? { vendor } : {}),
    },
  };
}
