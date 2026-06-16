/**
 * `settlekit usage` — usage-based billing: metering + prepaid credits.
 *
 *   record               POST /v1/usage/record
 *   grant-credits        POST /v1/usage/credits/grant
 *   consume-credits      POST /v1/usage/credits/consume
 *   credits              GET  /v1/usage/credits
 */
import type { Command } from "commander";
import { buildContext } from "../context.js";

/** Shared customer/product/org options for the usage subcommands. */
function refOptions(cmd: Command): Command {
  return cmd
    .requiredOption("--organization-id <id>", "Organization id")
    .requiredOption("--customer-id <id>", "Customer id")
    .requiredOption("--product-id <id>", "Product id");
}

export function registerUsage(program: Command): void {
  const usage = program.command("usage").description("Usage metering + prepaid credits");

  refOptions(usage.command("record").description("Record N units of a metric"))
    .requiredOption("--metric <metric>", "Metric name, e.g. api_calls")
    .option("--quantity <n>", "Units to record", (v) => Number.parseInt(v, 10), 1)
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const meter = await ctx.client.post<Record<string, unknown>>("/v1/usage/record", {
        organizationId: opts.organizationId,
        customerId: opts.customerId,
        productId: opts.productId,
        metric: opts.metric,
        quantity: opts.quantity,
      });
      ctx.printRecord(meter);
    });

  refOptions(usage.command("grant-credits").description("Grant prepaid credits"))
    .requiredOption("--credits <n>", "Credits to grant", (v) => Number.parseInt(v, 10))
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const balance = await ctx.client.post<Record<string, unknown>>("/v1/usage/credits/grant", {
        organizationId: opts.organizationId,
        customerId: opts.customerId,
        productId: opts.productId,
        credits: opts.credits,
      });
      ctx.printRecord(balance);
    });

  refOptions(usage.command("consume-credits").description("Consume prepaid credits"))
    .option("--credits <n>", "Credits to consume", (v) => Number.parseInt(v, 10), 1)
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const balance = await ctx.client.post<Record<string, unknown>>("/v1/usage/credits/consume", {
        organizationId: opts.organizationId,
        customerId: opts.customerId,
        productId: opts.productId,
        credits: opts.credits,
      });
      ctx.printRecord(balance);
    });

  refOptions(usage.command("credits").description("Read a prepaid credit balance")).action(
    async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const balance = await ctx.client.get<Record<string, unknown>>("/v1/usage/credits", {
        organizationId: opts.organizationId,
        customerId: opts.customerId,
        productId: opts.productId,
      });
      ctx.printRecord(balance);
    },
  );
}
