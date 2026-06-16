/**
 * `settlekit products` — manage products and their prices.
 *
 * Subcommands:
 *   list                 GET  /v1/products
 *   create               POST /v1/products
 *   get <id>             GET  /v1/products/:id
 *   add-price <id>       POST /v1/products/:id/prices
 */
import type { Command } from "commander";
import { buildContext } from "../context.js";

interface Product extends Record<string, unknown> {
  id: string;
  name: string;
  type: string;
  deliveryMode: string;
  status?: string;
}

export function registerProducts(program: Command): void {
  const products = program.command("products").description("Manage products and prices");

  products
    .command("list")
    .description("List products")
    .action(async function (this: Command) {
      const ctx = buildContext(this);
      const rows = await ctx.client.get<Product[]>("/v1/products");
      ctx.printList(rows, [
        { header: "ID", value: (p) => p.id },
        { header: "NAME", value: (p) => p.name },
        { header: "TYPE", value: (p) => p.type },
        { header: "DELIVERY", value: (p) => p.deliveryMode },
        { header: "STATUS", value: (p) => p.status },
      ]);
    });

  products
    .command("create")
    .description("Create a product")
    .requiredOption("--merchant-id <id>", "Merchant id")
    .requiredOption("--organization-id <id>", "Organization id")
    .requiredOption("--name <name>", "Product name")
    .requiredOption("--type <type>", "Product type (e.g. saas_plan, github_repo_access)")
    .requiredOption("--delivery-mode <mode>", "Delivery mode (e.g. license_key, api_key)")
    .option("--description <text>", "Product description", "")
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const product = await ctx.client.post<Product>("/v1/products", {
        merchantId: opts.merchantId,
        organizationId: opts.organizationId,
        name: opts.name,
        description: opts.description,
        type: opts.type,
        deliveryMode: opts.deliveryMode,
      });
      ctx.printRecord(product);
    });

  products
    .command("get <id>")
    .description("Get a product by id")
    .action(async function (this: Command, id: string) {
      const ctx = buildContext(this);
      const product = await ctx.client.get<Product>(`/v1/products/${encodeURIComponent(id)}`);
      ctx.printRecord(product);
    });

  products
    .command("add-price <id>")
    .description("Add a price to a product")
    .requiredOption("--amount <amount>", "Decimal amount, e.g. 25.00")
    .option("--interval <interval>", "one_time | monthly | yearly", "one_time")
    .option("--credits-granted <n>", "Credits granted by this price", (v) => Number.parseInt(v, 10))
    .action(async function (this: Command, id: string) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const body: Record<string, unknown> = {
        amount: opts.amount,
        interval: opts.interval,
      };
      if (opts.creditsGranted !== undefined) body.creditsGranted = opts.creditsGranted;
      const price = await ctx.client.post<Record<string, unknown>>(
        `/v1/products/${encodeURIComponent(id)}/prices`,
        body,
      );
      ctx.printRecord(price);
    });
}
