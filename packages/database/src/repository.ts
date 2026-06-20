import { eq, and, or, lt, lte, gt, gte, inArray, isNull, type SQL } from "drizzle-orm";
import type {
  PgTable,
  PgColumn,
  TableConfig,
} from "drizzle-orm/pg-core";
import type {
  InferSelectModel,
  InferInsertModel,
} from "drizzle-orm";
import type { Database } from "./client.js";

/**
 * A table that exposes a text `id` primary key column. Every SettleKit table
 * satisfies this, which lets the generic repository key rows by id.
 */
export type TableWithId = PgTable<TableConfig> & {
  id: PgColumn;
};

/** The row shape returned when selecting from `TTable`. */
export type Row<TTable extends TableWithId> = InferSelectModel<TTable>;

/** The shape accepted when inserting into `TTable`. */
export type NewRow<TTable extends TableWithId> = InferInsertModel<TTable>;

/**
 * A generic data-access interface over a single drizzle table, keyed by its
 * text `id` primary key. Concrete behaviour is provided by
 * {@link createRepository}; this interface exists so callers and tests can
 * depend on the abstraction rather than the implementation.
 */
export interface Repository<TTable extends TableWithId> {
  /** Find a single row by its primary key, or `null` if absent. */
  findById(id: string): Promise<Row<TTable> | null>;
  /** Find rows matching an optional drizzle `where` predicate. */
  findMany(where?: SQL): Promise<Row<TTable>[]>;
  /** Insert one row and return the inserted record. */
  insert(values: NewRow<TTable>): Promise<Row<TTable>>;
  /** Patch a row by id and return the updated record, or `null` if absent. */
  update(id: string, values: Partial<NewRow<TTable>>): Promise<Row<TTable> | null>;
  /** Delete a row by id. Returns `true` when a row was removed. */
  delete(id: string): Promise<boolean>;
}

/**
 * Build a {@link Repository} bound to a specific drizzle database and table.
 *
 * All operations are real parameterised queries via the drizzle query builder;
 * no string interpolation is performed, so they are injection-safe.
 */
export function createRepository<TTable extends TableWithId>(
  db: Database,
  table: TTable,
): Repository<TTable> {
  return {
    async findById(id) {
      const rows = await db
        .select()
        .from(table as PgTable<TableConfig>)
        .where(eq(table.id, id))
        .limit(1);
      return (rows[0] as Row<TTable> | undefined) ?? null;
    },

    async findMany(where) {
      const query = db.select().from(table as PgTable<TableConfig>);
      const rows = where ? await query.where(where) : await query;
      return rows as Row<TTable>[];
    },

    async insert(values) {
      const rows = await db
        .insert(table)
        .values(values as NewRow<TTable>)
        .returning();
      const inserted = rows[0];
      if (!inserted) {
        throw new Error("insert returned no rows");
      }
      return inserted as Row<TTable>;
    },

    async update(id, values) {
      const rows = await db
        .update(table)
        .set(values)
        .where(eq(table.id, id))
        .returning();
      return (rows[0] as Row<TTable> | undefined) ?? null;
    },

    async delete(id) {
      const rows = await db
        .delete(table)
        .where(eq(table.id, id))
        .returning({ id: table.id });
      return rows.length > 0;
    },
  };
}

/** Re-export of common drizzle predicate helpers for repository callers. */
export { eq, and, or, lt, lte, gt, gte, inArray, isNull };
export type { SQL };
