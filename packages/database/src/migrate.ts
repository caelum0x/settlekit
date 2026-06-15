import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { schema } from "./schema/index.js";

/** Options controlling programmatic migration. */
export interface MigrateOptions {
  /** Directory containing generated drizzle SQL migrations. */
  migrationsFolder: string;
  /** Migrations metadata table name. Defaults to drizzle's own. */
  migrationsTable?: string;
  /** Postgres schema the migrations table lives in. Defaults to "drizzle". */
  migrationsSchema?: string;
}

/**
 * Run all pending migrations against the database at `connectionString`.
 *
 * Uses a dedicated single-connection client (`max: 1`) per drizzle's migrator
 * guidance, and always closes it — even on failure — to avoid leaking the
 * connection when invoked from short-lived deploy jobs.
 */
export async function runMigrations(
  connectionString: string,
  options: MigrateOptions,
): Promise<void> {
  const client = postgres(connectionString, { max: 1 });
  try {
    const db = drizzle(client, { schema });
    await migrate(db, {
      migrationsFolder: options.migrationsFolder,
      migrationsTable: options.migrationsTable,
      migrationsSchema: options.migrationsSchema,
    });
  } finally {
    await client.end();
  }
}
