/**
 * Runs every @settlekit example in sequence and prints the result of each.
 *
 * Each example exports an async `main()` that performs a real end-to-end
 * interaction with the @settlekit packages and returns a structured result.
 * This runner is the package `start` script: `node --import tsx src/run-all.ts`.
 */
import { main as saasEntitlementCheck } from "./saas-entitlement-check.js";
import { main as x402PaidApi } from "./x402-paid-api.js";
import { main as licenseVerify } from "./license-verify.js";
import { main as githubRepoSale } from "./github-repo-sale.js";
import { main as bundleCheckout } from "./bundle-checkout.js";

/** An example: a human label plus its `main()` entrypoint. */
interface Example {
  readonly name: string;
  readonly run: () => Promise<unknown>;
}

export const examples: readonly Example[] = [
  { name: "saas-entitlement-check", run: saasEntitlementCheck },
  { name: "x402-paid-api", run: x402PaidApi },
  { name: "license-verify", run: licenseVerify },
  { name: "github-repo-sale", run: githubRepoSale },
  { name: "bundle-checkout", run: bundleCheckout },
];

export interface ExampleRunReport {
  name: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Run every example. Returns a report per example; throws only if asked to and
 * one fails. The default behavior collects all reports so callers (and tests)
 * can inspect each outcome.
 */
export async function runAll(): Promise<ExampleRunReport[]> {
  const reports: ExampleRunReport[] = [];
  for (const example of examples) {
    try {
      const result = await example.run();
      reports.push({ name: example.name, ok: true, result });
      console.log(`✓ ${example.name}`);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reports.push({ name: example.name, ok: false, error: message });
      console.error(`✗ ${example.name}: ${message}`);
    }
  }
  return reports;
}

/** Convenience entrypoint also usable from tests. */
export async function main(): Promise<ExampleRunReport[]> {
  const reports = await runAll();
  const failed = reports.filter((r) => !r.ok);
  if (failed.length > 0) {
    throw new Error(
      `${failed.length} example(s) failed: ${failed.map((f) => f.name).join(", ")}`,
    );
  }
  return reports;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((reports) => {
      console.log(`\nAll ${reports.length} examples passed.`);
    })
    .catch((err) => {
      console.error("\nrun-all failed:", err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
