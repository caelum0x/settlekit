/**
 * @settlekit/database — the persistence layer for the SettleKit Commerce OS.
 *
 * Exposes the full drizzle-orm schema, a typed `createDb` factory over the
 * postgres-js driver, a programmatic migrator, and a generic table repository.
 */
import { getTableName } from "drizzle-orm";

export * from "./schema/index.js";
export * from "./client.js";
export * from "./migrate.js";
export * from "./repository.js";
export * from "./doc.js";

import { schema } from "./schema/index.js";

/**
 * The canonical list of physical table names in the SettleKit schema, derived
 * directly from the drizzle table definitions (single source of truth).
 */
export const DATABASE_TABLES: readonly string[] = Object.values(schema).map(
  (table) => getTableName(table),
);

/** The static union of SettleKit table variable names. */
export type SchemaTableName = keyof typeof schema;

/** Returns true when `value` is the name of a known schema table variable. */
export function isSchemaTable(value: string): value is SchemaTableName {
  return Object.prototype.hasOwnProperty.call(schema, value);
}
