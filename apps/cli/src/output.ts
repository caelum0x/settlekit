/**
 * Terminal output helpers: a dependency-free table printer, key/value summary
 * printer, JSON printer, and a consistent error formatter.
 *
 * Tables compute column widths from header + cell contents and pad each cell to
 * align columns. Values are stringified with {@link cellText}, which flattens
 * money objects, arrays, and nested objects into readable single-line text.
 */
import { ApiError } from "./api.js";

/** A column definition for {@link printTable}. */
export interface Column<T> {
  /** Header label shown in the first row. */
  header: string;
  /** Extract the cell value from a row; result is stringified via cellText. */
  value: (row: T) => unknown;
}

/** Convert an arbitrary value into a single-line display string. */
export function cellText(value: unknown): string {
  if (value === undefined || value === null) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  // Money: { amount, currency }
  if (
    typeof value === "object" &&
    value !== null &&
    "amount" in value &&
    "currency" in value
  ) {
    const m = value as { amount: unknown; currency: unknown };
    return `${String(m.amount)} ${String(m.currency)}`;
  }
  if (Array.isArray(value)) {
    return value.map((v) => cellText(v)).join(", ");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Pad a string to a fixed width with trailing spaces. */
function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

/**
 * Render `rows` as an aligned text table using the provided columns.
 * Prints a friendly "No results." line when the row set is empty.
 */
export function printTable<T>(rows: readonly T[], columns: readonly Column<T>[]): void {
  if (rows.length === 0) {
    process.stdout.write("No results.\n");
    return;
  }

  const headers = columns.map((c) => c.header);
  const body = rows.map((row) => columns.map((c) => cellText(c.value(row))));

  const widths = headers.map((header, i) => {
    const cellMax = body.reduce(
      (max, cells) => Math.max(max, (cells[i] ?? "").length),
      0,
    );
    return Math.max(header.length, cellMax);
  });

  const headerLine = headers.map((h, i) => pad(h, widths[i] ?? 0)).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");

  process.stdout.write(`${headerLine}\n`);
  process.stdout.write(`${separator}\n`);
  for (const cells of body) {
    process.stdout.write(
      cells.map((cell, i) => pad(cell, widths[i] ?? 0)).join("  ") + "\n",
    );
  }
}

/**
 * Print an object as an aligned `key: value` summary. Keys are padded to align
 * their values. Useful for single-record `get`/`create` results.
 */
export function printSummary(record: Record<string, unknown>): void {
  const entries = Object.entries(record);
  if (entries.length === 0) {
    process.stdout.write("(empty)\n");
    return;
  }
  const keyWidth = entries.reduce((max, [key]) => Math.max(max, key.length), 0);
  for (const [key, value] of entries) {
    process.stdout.write(`${pad(`${key}:`, keyWidth + 1)} ${cellText(value)}\n`);
  }
}

/** Print any value as pretty-printed JSON to stdout. */
export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Format an error for stderr. {@link ApiError} surfaces its code; other errors
 * print their message. Returns the string so callers can also use it in tests.
 */
export function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    const status = err.status ? ` (HTTP ${err.status})` : "";
    return `Error [${err.code}]${status}: ${err.message}`;
  }
  if (err instanceof Error) return `Error: ${err.message}`;
  return `Error: ${String(err)}`;
}
