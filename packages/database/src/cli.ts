/**
 * Migration CLI — runs all pending SQL migrations against `DATABASE_URL`.
 *
 * Uses the programmatic `runMigrations` (drizzle-orm's migrator + `postgres`,
 * both runtime deps) so it works inside the pruned production Docker image — no
 * `drizzle-kit` (a dev dependency) required. The migrations folder is resolved
 * relative to this compiled file (`packages/database/drizzle`, copied into the
 * image), so it does not depend on the working directory.
 *
 * Invoked by Render's `preDeployCommand` before the API starts, or manually:
 *   DATABASE_URL=postgres://… node packages/database/dist/cli.js
 */
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrate.js";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("[migrate] DATABASE_URL is required");
    process.exit(1);
  }

  const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
  console.log(`[migrate] applying migrations from ${migrationsFolder}`);
  await runMigrations(connectionString, { migrationsFolder });
  console.log("[migrate] all migrations applied");
}

main().catch((err: unknown) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
