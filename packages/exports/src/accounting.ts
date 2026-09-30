/**
 * Accounting exports: a merchant's USDC ledger as CSV files that Xero and
 * QuickBooks Online import as bank statements (Xero "Import a bank
 * statement", QuickBooks "Upload transactions from a file"). No OAuth app is
 * needed; the merchant imports the file into a "USDC wallet" bank account.
 *
 * Money in is a positive amount, money out (refunds, fees) negative.
 */
import { toCsv, type CsvColumn } from "./index.js";

/** One movement in the merchant's USDC wallet. */
export interface LedgerEntry {
  /** ISO timestamp the movement settled. */
  date: string;
  /** Signed decimal amount (positive = received). */
  amount: string;
  currency: string;
  /** Counterparty (buyer email / customer id, or "SettleKit"). */
  payee: string;
  description: string;
  /** Payment / refund / invoice id. */
  reference: string;
  network: string;
  txHash: string;
  kind: "payment" | "refund" | "fee";
}

function ymd(iso: string): [string, string, string] {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return ["", "", ""];
  return [String(d.getUTCFullYear()), String(d.getUTCMonth() + 1).padStart(2, "0"), String(d.getUTCDate()).padStart(2, "0")];
}

/** DD/MM/YYYY, the Xero default for bank statement imports. */
export function xeroDate(iso: string): string {
  const [y, m, d] = ymd(iso);
  return y ? `${d}/${m}/${y}` : "";
}

/** MM/DD/YYYY, the QuickBooks Online (US) bank upload format. */
export function quickBooksDate(iso: string): string {
  const [y, m, d] = ymd(iso);
  return y ? `${m}/${d}/${y}` : "";
}

const GUARD = { guardFormulas: true };

function memo(e: LedgerEntry): string {
  return [e.description, e.network, e.txHash].filter(Boolean).join(" | ");
}

/** Xero bank statement CSV: Date, Amount, Payee, Description, Reference. */
export function xeroStatementCsv(entries: readonly LedgerEntry[]): string {
  const columns: CsvColumn<LedgerEntry>[] = [
    { header: "*Date", value: (e) => xeroDate(e.date) },
    { header: "*Amount", value: (e) => e.amount },
    { header: "Payee", value: (e) => e.payee },
    { header: "Description", value: memo },
    { header: "Reference", value: (e) => e.reference },
  ];
  return toCsv([...entries], columns, GUARD);
}

/** QuickBooks Online 3-column bank upload CSV: Date, Description, Amount. */
export function quickBooksStatementCsv(entries: readonly LedgerEntry[]): string {
  const columns: CsvColumn<LedgerEntry>[] = [
    { header: "Date", value: (e) => quickBooksDate(e.date) },
    { header: "Description", value: (e) => [e.payee, memo(e), e.reference].filter(Boolean).join(" | ") },
    { header: "Amount", value: (e) => e.amount },
  ];
  return toCsv([...entries], columns, GUARD);
}

/** Plain ledger CSV with every field (for any other tool). */
export function ledgerCsv(entries: readonly LedgerEntry[]): string {
  const columns: CsvColumn<LedgerEntry>[] = [
    { header: "date", value: (e) => e.date },
    { header: "kind", value: (e) => e.kind },
    { header: "amount", value: (e) => e.amount },
    { header: "currency", value: (e) => e.currency },
    { header: "payee", value: (e) => e.payee },
    { header: "description", value: (e) => e.description },
    { header: "reference", value: (e) => e.reference },
    { header: "network", value: (e) => e.network },
    { header: "tx_hash", value: (e) => e.txHash },
  ];
  return toCsv([...entries], columns, GUARD);
}

/** Keep entries in [from, to) and sort oldest first. */
export function inRange(entries: readonly LedgerEntry[], from?: Date, to?: Date): LedgerEntry[] {
  return entries
    .filter((e) => {
      const t = new Date(e.date).getTime();
      return (from === undefined || t >= from.getTime()) && (to === undefined || t < to.getTime());
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
