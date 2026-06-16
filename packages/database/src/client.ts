import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import type { Sql, Options } from "postgres";
import { schema } from "./schema/index.js";
import type { Schema } from "./schema/index.js";

/** A fully-typed SettleKit drizzle database handle. */
export type Database = PostgresJsDatabase<Schema>;

/** Options for constructing a database connection. */
export interface CreateDbOptions {
  /** Maximum number of pooled connections. Defaults to 10. */
  max?: number;
  /** Idle timeout (seconds) before a pooled connection is closed. */
  idleTimeout?: number;
  /** Connection timeout (seconds). */
  connectTimeout?: number;
  /** SSL mode passed through to the postgres-js driver. */
  ssl?: Options<Record<string, never>>["ssl"];
  /** Schema-prefixed application name for observability. */
  applicationName?: string;
}

/** A database handle paired with the underlying postgres-js client. */
export interface DbConnection {
  /** The typed drizzle query interface. */
  db: Database;
  /** The raw postgres-js client, used for shutdown and migrations. */
  client: Sql;
  /** Close the underlying connection pool. */
  close: () => Promise<void>;
}

/**
 * Create the postgres-js client and drizzle wrapper for a connection string.
 *
 * Returns the drizzle handle directly; for migrations or graceful shutdown use
 * {@link createConnection} which also exposes the raw client.
 */
export function createDb(
  connectionString: string,
  options: CreateDbOptions = {},
): Database {
  return createConnection(connectionString, options).db;
}

/**
 * Create a full {@link DbConnection}, exposing the raw postgres-js client
 * alongside the typed drizzle handle.
 */
export function createConnection(
  connectionString: string,
  options: CreateDbOptions = {},
): DbConnection {
  const client = postgres(connectionString, {
    max: options.max ?? 10,
    idle_timeout: options.idleTimeout,
    connect_timeout: options.connectTimeout,
    ssl: options.ssl,
    connection: options.applicationName
      ? { application_name: options.applicationName }
      : undefined,
  });

  const db = drizzle(client, { schema });

  return {
    db,
    client,
    close: () => client.end(),
  };
}

/**
 * Liveness/readiness ping: runs a trivial `SELECT 1` and resolves `true` when the
 * database answers. Resolves `false` on any error (so a readiness probe can map
 * it to 503 rather than throwing). Used by the API's `/health/ready` endpoint.
 */
export async function ping(db: Database): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
