/**
 * `settlekit license-keys` — issue and verify license keys.
 *
 *   create               POST /v1/license-keys
 *   verify               POST /v1/license-keys/verify
 */
import type { Command } from "commander";
import { buildContext } from "../context.js";

export function registerLicenseKeys(program: Command): void {
  const licenses = program.command("license-keys").description("Issue and verify license keys");

  licenses
    .command("create")
    .description("Issue a license key")
    .requiredOption("--organization-id <id>", "Organization id")
    .requiredOption("--customer-id <id>", "Customer id")
    .requiredOption("--product-id <id>", "Product id")
    .requiredOption("--entitlement-id <id>", "Entitlement id")
    .option("--machine-limit <n>", "Max machine activations", (v) => Number.parseInt(v, 10), 1)
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const license = await ctx.client.post<Record<string, unknown>>("/v1/license-keys", {
        organizationId: opts.organizationId,
        customerId: opts.customerId,
        productId: opts.productId,
        entitlementId: opts.entitlementId,
        machineLimit: opts.machineLimit,
      });
      ctx.printRecord(license);
    });

  licenses
    .command("verify")
    .description("Verify a license key for a product + machine")
    .requiredOption("--license-key <key>", "License key to verify")
    .requiredOption("--product-id <id>", "Product id")
    .requiredOption("--machine-id <id>", "Machine fingerprint")
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const result = await ctx.client.post<Record<string, unknown>>("/v1/license-keys/verify", {
        licenseKey: opts.licenseKey,
        productId: opts.productId,
        machineId: opts.machineId,
      });
      ctx.printRecord(result);
    });
}
