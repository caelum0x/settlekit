/**
 * `settlekit customers` — manage customers.
 *
 * Subcommands:
 *   list      GET  /v1/customers
 *   create    POST /v1/customers
 */
import type { Command } from "commander";
import { buildContext } from "../context.js";

interface Customer extends Record<string, unknown> {
  id: string;
  email: string;
  name?: string;
  githubUsername?: string;
}

export function registerCustomers(program: Command): void {
  const customers = program.command("customers").description("Manage customers");

  customers
    .command("list")
    .description("List customers")
    .action(async function (this: Command) {
      const ctx = buildContext(this);
      const rows = await ctx.client.get<Customer[]>("/v1/customers");
      ctx.printList(rows, [
        { header: "ID", value: (c) => c.id },
        { header: "EMAIL", value: (c) => c.email },
        { header: "NAME", value: (c) => c.name },
        { header: "GITHUB", value: (c) => c.githubUsername },
      ]);
    });

  customers
    .command("create")
    .description("Create a customer")
    .requiredOption("--organization-id <id>", "Organization id")
    .requiredOption("--email <email>", "Customer email")
    .option("--name <name>", "Customer name")
    .option("--github-username <username>", "GitHub username")
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const body: Record<string, unknown> = {
        organizationId: opts.organizationId,
        email: opts.email,
      };
      if (opts.name !== undefined) body.name = opts.name;
      if (opts.githubUsername !== undefined) body.githubUsername = opts.githubUsername;
      const customer = await ctx.client.post<Customer>("/v1/customers", body);
      ctx.printRecord(customer);
    });
}
