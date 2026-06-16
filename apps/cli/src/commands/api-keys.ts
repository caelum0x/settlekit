/**
 * `settlekit api-keys` — issue and verify API keys.
 *
 *   create               POST /v1/api-keys   (returns the plaintext once)
 *   verify               POST /v1/api-keys/verify
 */
import type { Command } from "commander";
import { buildContext } from "../context.js";

/** Split a comma-separated option into a trimmed, non-empty list. */
function list(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function registerApiKeys(program: Command): void {
  const apiKeys = program.command("api-keys").description("Issue and verify API keys");

  apiKeys
    .command("create")
    .description("Issue a scoped API key (plaintext shown once)")
    .requiredOption("--organization-id <id>", "Organization id")
    .requiredOption("--customer-id <id>", "Customer id")
    .requiredOption("--product-id <id>", "Product id")
    .requiredOption("--entitlement-id <id>", "Entitlement id")
    .requiredOption("--scopes <list>", "Comma-separated scopes, e.g. read,write", list)
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const result = await ctx.client.post<Record<string, unknown>>("/v1/api-keys", {
        organizationId: opts.organizationId,
        customerId: opts.customerId,
        productId: opts.productId,
        entitlementId: opts.entitlementId,
        scopes: opts.scopes,
      });
      ctx.printRecord(result);
    });

  apiKeys
    .command("verify")
    .description("Verify an API key and (optionally) required scopes")
    .requiredOption("--key <key>", "Plaintext API key")
    .option("--required-scopes <list>", "Comma-separated required scopes", list, [])
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const result = await ctx.client.post<Record<string, unknown>>("/v1/api-keys/verify", {
        key: opts.key,
        requiredScopes: opts.requiredScopes,
      });
      ctx.printRecord(result);
    });
}
