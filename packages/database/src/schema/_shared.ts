import { text, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Shared column factories used across every SettleKit table.
 *
 * Conventions:
 * - Primary keys are prefixed text ids (Stripe-style, generated in @settlekit/common).
 * - All timestamps are `timestamp with time zone` ({@link timestamp} `withTimezone`).
 * - Monetary amounts are stored as `numeric` and surfaced as strings to avoid
 *   floating point rounding (see {@link amountColumn}).
 * - Free-form metadata is stored as `jsonb`.
 */

/** A required prefixed-text primary key column. */
export function idColumn(name = "id") {
  return text(name).primaryKey();
}

/** A `timestamptz` column defaulting to `now()`, non-null. */
export function createdAtColumn(name = "created_at") {
  return timestamp(name, { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow();
}

/** A `timestamptz` column defaulting to `now()`, non-null (for update tracking). */
export function updatedAtColumn(name = "updated_at") {
  return timestamp(name, { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow();
}

/** A nullable `timestamptz` column. */
export function nullableTimestamp(name: string) {
  return timestamp(name, { withTimezone: true, mode: "date" });
}

/** A required `timestamptz` column (no default). */
export function requiredTimestamp(name: string) {
  return timestamp(name, { withTimezone: true, mode: "date" }).notNull();
}

/**
 * A monetary amount column. Stored as `numeric(38, 18)` and represented as a
 * string in TypeScript so callers use {@link Money} semantics from
 * @settlekit/common without precision loss.
 */
export function amountColumn(name: string) {
  return text(name);
}

/** A `jsonb` metadata column, defaulting to an empty object, non-null. */
export function metadataColumn(name = "metadata") {
  return jsonb(name)
    .$type<Record<string, unknown>>()
    .notNull()
    .default({});
}

/** Standard created/updated timestamp pair to spread into a table definition. */
export const timestamps = {
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
};
