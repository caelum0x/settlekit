/**
 * Runs the operator's API route and worker job tests (apps/api, apps/worker).
 *
 * Those apps' tsconfig.json files reference packages/solana, which is not on
 * this branch, so Vite's tsconfig lookup fails before any test loads. A
 * string `tsconfigRaw` (mirroring tsconfig.base.json's emit-relevant options)
 * makes esbuild skip that lookup. Usage: pnpm --filter @settlekit/operator test:apps
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  root,
  esbuild: {
    tsconfigRaw: JSON.stringify({ compilerOptions: { target: "ES2022", verbatimModuleSyntax: true, useDefineForClassFields: true } }),
  },
  test: {
    root,
    include: ["apps/api/test/operator-*.test.ts", "apps/worker/test/operator-*.test.ts"],
    environment: "node",
  },
});
