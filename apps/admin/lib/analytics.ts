import { addMoney, money, type Money } from "@settlekit/common";
import type { AdminSettlement } from "./types";

/**
 * Pure aggregation helpers for the analytics page. No React, no I/O — kept
 * separate so the math (Money summation, day-bucketing, CSV escaping) stays
 * unit-testable and the page component stays thin.
 *
 * NOTE on freshness: settlements/webhooks may be served from Postgres when
 * DATABASE_URL is set, while risk profiles are always served from the in-memory
 * store (admin-owned review state). Mixing them in one view is fine, but the
 * counts can have slightly different freshness.
 */

/** A single time-series bucket: an ISO date (YYYY-MM-DD) and a count. */
export interface DayBucket {
  readonly date: string;
  readonly count: number;
}

/** A generic labelled value used by the bar chart. */
export interface BarDatum {
  readonly label: string;
  readonly value: number;
}

/** Extract the YYYY-MM-DD (UTC) prefix from an ISO timestamp, or null if invalid. */
function isoDay(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Group items into per-day counts using an ISO-timestamp selector.
 *
 * Returns the last `days` calendar days (UTC), oldest first, with zero-filled
 * gaps so the chart always renders a continuous axis even when activity is
 * sparse. `anchor` defaults to the current time but is injectable for testing
 * (no hidden Date.now() in callers).
 */
export function bucketByDay<T>(
  items: readonly T[],
  isoSelector: (item: T) => string,
  days = 14,
  anchor: number = Date.now(),
): DayBucket[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const day = isoDay(isoSelector(item));
    if (day === null) continue;
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  const buckets: DayBucket[] = [];
  const dayMs = 86_400_000;
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = isoDay(new Date(anchor - i * dayMs).toISOString());
    if (date === null) continue;
    buckets.push({ date, count: counts.get(date) ?? 0 });
  }
  return buckets;
}

/** Sum the amounts of settlements with status `settled`, immutably. */
export function sumSettledVolume(settlements: readonly AdminSettlement[]): Money {
  return settlements
    .filter((s) => s.status === "settled")
    .reduce<Money>((sum, s) => addMoney(sum, s.amount), money("0"));
}

/** Count occurrences of each value produced by `selector`. */
export function countBy<T>(
  items: readonly T[],
  selector: (item: T) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = selector(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Escape a single CSV field per RFC 4180 (quote when it contains , " or newline). */
export function csvField(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** A CSV column: a header label and an extractor for a row. */
export interface CsvColumn<T> {
  readonly header: string;
  readonly value: (row: T) => unknown;
}

/** Build an RFC-4180 CSV string (CRLF line endings) from rows + columns. */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const header = columns.map((c) => csvField(c.header)).join(",");
  const body = rows.map((row) =>
    columns.map((c) => csvField(c.value(row))).join(","),
  );
  return [header, ...body].join("\r\n");
}
