/**
 * Persistence codec for the document-projection pattern, shared across every
 * SettleKit app that talks to Postgres.
 *
 * Every SettleKit table carries a `jsonb metadata` column. Rather than risk
 * lossy column-by-column mapping between the (independently designed) database
 * schema and the @settlekit/common domain types, we store the FULL canonical
 * domain entity as a JSON document under `metadata.__doc`. Typed columns are
 * still written (projections) so SQL queries / admin tooling / indexes work,
 * but the document is the source of truth on read — guaranteeing lossless
 * round-trips regardless of schema drift.
 */

/** Reserved key inside the `metadata` jsonb column holding the canonical entity. */
export const DOC_KEY = "__doc";

/** Build the `metadata` jsonb value for a row: the canonical entity document. */
export function packDoc<T>(entity: T): Record<string, unknown> {
  return { [DOC_KEY]: entity as unknown };
}

/** Extract the canonical entity from a row's `metadata` jsonb, or null. */
export function unpackDoc<T>(
  row: { metadata: Record<string, unknown> | null } | null | undefined,
): T | null {
  if (!row || !row.metadata) return null;
  const doc = row.metadata[DOC_KEY];
  return (doc ?? null) as T | null;
}

/** Map a list of rows to their canonical entities, dropping any without a doc. */
export function unpackDocs<T>(
  rows: ReadonlyArray<{ metadata: Record<string, unknown> | null }>,
): T[] {
  const out: T[] = [];
  for (const row of rows) {
    const doc = unpackDoc<T>(row);
    if (doc !== null) out.push(doc);
  }
  return out;
}
