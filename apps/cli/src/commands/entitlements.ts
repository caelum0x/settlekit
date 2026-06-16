/**
 * `settlekit entitlements` — the universal access layer.
 *
 *   list                 GET  /v1/entitlements?customerId=
 *   verify               POST /v1/entitlements/verify
 *   spend-credits        POST /v1/entitlements/spend-credits
 *   get <id>            GET  /v1/entitlements/:id
 *   revoke <id>         POST /v1/entitlements/:id/revoke
 *
 * `verify` is the access-gate hot path: it answers whether a customer may use a
 * feature / product / credits and is what the SDKs call.
 */
import type { Command } from "commander";
import { buildContext } from "../context.js";

interface Entitlement extends Record<string, unknown> {
  id: string;
  customerId: string;
  productId?: string;
  status: string;
  remainingCredits?: number;
}

export function registerEntitlements(program: Command): void {
  const entitlements = program
    .command("entitlements")
    .description("Inspect, verify, and revoke customer access");

  entitlements
    .command("list")
    .description("List a customer's entitlements")
    .requiredOption("--customer-id <id>", "Customer id")
    .option("--product-id <id>", "Filter by product")
    .option("--active-only", "Only return currently-active entitlements", false)
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const rows = await ctx.client.get<Entitlement[]>("/v1/entitlements", {
        customerId: opts.customerId,
        productId: opts.productId,
        activeOnly: opts.activeOnly ? "true" : undefined,
      });
      ctx.printList(rows, [
        { header: "ID", value: (e) => e.id },
        { header: "PRODUCT", value: (e) => e.productId },
        { header: "STATUS", value: (e) => e.status },
        { header: "CREDITS", value: (e) => e.remainingCredits },
      ]);
    });

  entitlements
    .command("verify")
    .description("Check whether a customer has access (feature / product / credits)")
    .requiredOption("--customer-id <id>", "Customer id")
    .option("--product-id <id>", "Product to check access to")
    .option("--feature <key>", "Feature flag to check")
    .option("--required-credits <n>", "Minimum credits required", (v) => Number.parseInt(v, 10))
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const body: Record<string, unknown> = { customerId: opts.customerId };
      if (opts.productId) body.productId = opts.productId;
      if (opts.feature) body.feature = opts.feature;
      if (opts.requiredCredits !== undefined) body.requiredCredits = opts.requiredCredits;
      const result = await ctx.client.post<Record<string, unknown>>(
        "/v1/entitlements/verify",
        body,
      );
      ctx.printRecord(result);
    });

  entitlements
    .command("spend-credits")
    .description("Spend credits against a product entitlement")
    .requiredOption("--customer-id <id>", "Customer id")
    .requiredOption("--product-id <id>", "Product id")
    .requiredOption("--amount <n>", "Number of credits to spend", (v) => Number.parseInt(v, 10))
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const updated = await ctx.client.post<Entitlement>("/v1/entitlements/spend-credits", {
        customerId: opts.customerId,
        productId: opts.productId,
        amount: opts.amount,
      });
      ctx.printRecord(updated);
    });

  entitlements
    .command("get <id>")
    .description("Fetch a single entitlement")
    .action(async function (this: Command, id: string) {
      const ctx = buildContext(this);
      const ent = await ctx.client.get<Entitlement>(
        `/v1/entitlements/${encodeURIComponent(id)}`,
      );
      ctx.printRecord(ent);
    });

  entitlements
    .command("revoke <id>")
    .description("Revoke an entitlement")
    .option("--reason <reason>", "Why it is being revoked", "revoked via CLI")
    .action(async function (this: Command, id: string) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const revoked = await ctx.client.post<Entitlement>(
        `/v1/entitlements/${encodeURIComponent(id)}/revoke`,
        { reason: opts.reason },
      );
      ctx.printRecord(revoked);
    });
}
