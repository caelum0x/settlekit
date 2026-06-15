import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration for the SettleKit schema.
 *
 * - `schema` points at the aggregated table definitions.
 * - `out` is where generated SQL migrations are written (checked into git).
 * - `dialect` is PostgreSQL (the platform's primary store).
 *
 * Generate a migration after changing the schema:  pnpm --filter @settlekit/database db:generate
 * Apply migrations against DATABASE_URL:            pnpm --filter @settlekit/database db:migrate
 */
export default defineConfig({
  // Point at compiled JS: the TS sources use NodeNext ".js" import specifiers
  // that drizzle-kit's CJS bundler cannot resolve, but the emitted dist can.
  // Run `pnpm --filter @settlekit/database build` before generating.
  schema: "./dist/schema/index.js",
  out: "./drizzle",
  dialect: "postgresql",
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/settlekit",
  },
});
