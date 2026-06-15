export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | undefined;
}

export function toCsv<T>(rows: T[], columns: Array<CsvColumn<T>>): string {
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [
    columns.map((column) => escape(column.header)).join(","),
    ...rows.map((row) => columns.map((column) => escape(column.value(row))).join(",")),
  ].join("\n");
}

export function jsonExport<T>(rows: T[]): string {
  return JSON.stringify(rows, null, 2);
}
