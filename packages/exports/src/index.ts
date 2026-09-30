export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | undefined;
}

export interface CsvOptions {
  /**
   * Neutralize spreadsheet formulas: a text cell starting with =, +, -, @,
   * tab or carriage return gets a leading apostrophe (CSV injection guard).
   * Plain numbers are left alone. Use for any export built from user input.
   */
  guardFormulas?: boolean;
}

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/** Guard one cell value against formula injection. */
export function guardCell(value: unknown): string {
  const text = String(value ?? "");
  return FORMULA_START.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
}

export function toCsv<T>(rows: T[], columns: Array<CsvColumn<T>>, options: CsvOptions = {}): string {
  const cell = (value: unknown) => (options.guardFormulas ? guardCell(value) : String(value ?? ""));
  const escape = (value: unknown) => `"${cell(value).replaceAll('"', '""')}"`;
  return [
    columns.map((column) => escape(column.header)).join(","),
    ...rows.map((row) => columns.map((column) => escape(column.value(row))).join(",")),
  ].join("\n");
}

export function jsonExport<T>(rows: T[]): string {
  return JSON.stringify(rows, null, 2);
}

export * from "./accounting.js";
