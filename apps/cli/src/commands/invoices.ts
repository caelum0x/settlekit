/**
 * `settlekit invoices` — create and manage invoices.
 *
 *   list                 GET  /v1/invoices
 *   create               POST /v1/invoices
 *   finalize <id>        POST /v1/invoices/:id/finalize
 *   pay <id>             POST /v1/invoices/:id/pay
 *   void <id>            POST /v1/invoices/:id/void
 */
import type { Command } from "commander";
import { buildContext } from "../context.js";
import type { Money } from "../api.js";

interface Invoice extends Record<string, unknown> {
  id: string;
  number: string;
  status: string;
  total: Money;
}

export function registerInvoices(program: Command): void {
  const invoices = program.command("invoices").description("Create and manage invoices");

  invoices
    .command("list")
    .description("List invoices")
    .option("--customer-id <id>", "Filter by customer")
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const rows = await ctx.client.get<Invoice[]>(
        "/v1/invoices",
        opts.customerId ? { customerId: opts.customerId } : undefined,
      );
      ctx.printList(rows, [
        { header: "NUMBER", value: (i) => i.number },
        { header: "STATUS", value: (i) => i.status },
        { header: "TOTAL", value: (i) => i.total },
      ]);
    });

  invoices
    .command("create")
    .description("Create a draft invoice with one line item")
    .requiredOption("--organization-id <id>", "Organization id")
    .requiredOption("--customer-id <id>", "Customer id")
    .requiredOption("--description <text>", "Line item description")
    .option("--quantity <n>", "Quantity", (v) => Number.parseInt(v, 10), 1)
    .requiredOption("--unit-amount <amount>", "Unit amount, e.g. 15.00")
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const invoice = await ctx.client.post<Invoice>("/v1/invoices", {
        organizationId: opts.organizationId,
        customerId: opts.customerId,
        lineItems: [{ description: opts.description, quantity: opts.quantity, unitAmount: opts.unitAmount }],
      });
      ctx.printRecord(invoice);
    });

  for (const action of ["finalize", "pay", "void"] as const) {
    invoices
      .command(`${action} <id>`)
      .description(`${action.charAt(0).toUpperCase()}${action.slice(1)} an invoice`)
      .action(async function (this: Command, id: string) {
        const ctx = buildContext(this);
        const invoice = await ctx.client.post<Invoice>(`/v1/invoices/${encodeURIComponent(id)}/${action}`);
        ctx.printRecord(invoice);
      });
  }
}
