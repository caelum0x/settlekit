#!/usr/bin/env node
/**
 * Production entrypoint (root `pnpm start`, used by the Render service).
 *
 * When DATABASE_URL is set, applies any pending Postgres migrations before
 * booting the API — so making the deployment durable is a one-step change:
 * attach a Postgres database and set DATABASE_URL, and the schema is created /
 * updated automatically on the next deploy. Without DATABASE_URL the API runs
 * in in-memory mode and migrations are skipped.
 *
 * Migrations run via the bundled programmatic migrator (runtime deps only), so
 * this works in the pruned production image with no drizzle-kit.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.env.DATABASE_URL) {
  console.log("[start] DATABASE_URL detected — applying migrations");
  const result = spawnSync(
    process.execPath,
    [join(root, "packages/database/dist/cli.js")],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    console.error("[start] migrations failed; aborting boot");
    process.exit(result.status ?? 1);
  }
} else {
  console.log("[start] no DATABASE_URL — in-memory mode, skipping migrations");
}

const { startServer } = await import(
  pathToFileURL(join(root, "apps/api/dist/index.js")).href
);
await startServer();
