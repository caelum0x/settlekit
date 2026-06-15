export interface ImportResult<T> {
  rows: T[];
  errors: string[];
}

export function parseCsvLines(input: string): string[][] {
  return input.trim().split(/\r?\n/).map((line) => line.split(",").map((cell) => cell.trim()));
}

export function importRows<T>(input: string, mapRow: (headers: string[], cells: string[], index: number) => T): ImportResult<T> {
  const [headers, ...rows] = parseCsvLines(input);
  if (!headers) return { rows: [], errors: ["missing header row"] };
  const imported: T[] = [];
  const errors: string[] = [];
  rows.forEach((cells, index) => {
    try {
      imported.push(mapRow(headers, cells, index));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  });
  return { rows: imported, errors };
}
