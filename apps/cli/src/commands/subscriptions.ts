/**
 * `settlekit subscriptions` — manage recurring subscriptions.
 *
 *   list                 GET  /v1/subscriptions
 *   create               POST /v1/subscriptions
 *   get <id>             GET  /v1/subscriptions/:id
 *   renew <id>          POST /v1/subscriptions/:id/renew
 *   cancel <id>         POST /v1/subscriptions/:id/cancel
 *
 * Subscriptions require a recurring price (monthly/yearly). Creating one also
 * grants a subscription entitlement for the product.
 */
import type { Command } from "commander";
import { buildContext } from "../context.js";
import type { Money } from "../api.js";

interface Subscription extends Record<string, unknown> {
  id: string;
  customerId: string;
  productId: string;
  status: string;
  currentPeriodEnd?: string;
  amount?: Money;
}

interface CreateResult {
  subscription: Subscription;
  entitlement?: Record<string, unknown>;
}

const SUBSCRIPTION_COLUMNS = [
  { header: "ID", value: (s: Subscription) => s.id },
  { header: "CUSTOMER", value: (s: Subscription) => s.customerId },
  { header: "PRODUCT", value: (s: Subscription) => s.productId },
  { header: "STATUS", value: (s: Subscription) => s.status },
  { header: "RENEWS", value: (s: Subscription) => s.currentPeriodEnd },
] as const;

export function registerSubscriptions(program: Command): void {
  const subscriptions = program
    .command("subscriptions")
    .description("Manage recurring subscriptions");

  subscriptions
    .command("list")
    .description("List subscriptions for an organization")
    .option("--organization-id <id>", "Organization id (defaults to platform org)")
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const rows = await ctx.client.get<Subscription[]>("/v1/subscriptions", {
        organizationId: opts.organizationId,
      });
      ctx.printList(rows, SUBSCRIPTION_COLUMNS);
    });

  subscriptions
    .command("create")
    .description("Create a subscription from a recurring price")
    .requiredOption("--organization-id <id>", "Organization id")
    .requiredOption("--customer-id <id>", "Customer id")
    .requiredOption("--product-id <id>", "Product id")
    .requiredOption("--price-id <id>", "Recurring price id (monthly/yearly)")
    .option("--cancel-at-period-end", "Schedule cancellation at the end of the first period", false)
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const body: Record<string, unknown> = {
        organizationId: opts.organizationId,
        customerId: opts.customerId,
        productId: opts.productId,
        priceId: opts.priceId,
      };
      if (opts.cancelAtPeriodEnd) body.cancelAtPeriodEnd = true;
      const result = await ctx.client.post<CreateResult>("/v1/subscriptions", body);
      ctx.printRecord(result.subscription);
    });

  subscriptions
    .command("get <id>")
    .description("Fetch a single subscription")
    .action(async function (this: Command, id: string) {
      const ctx = buildContext(this);
      const sub = await ctx.client.get<Subscription>(
        `/v1/subscriptions/${encodeURIComponent(id)}`,
      );
      ctx.printRecord(sub);
    });

  subscriptions
    .command("renew <id>")
    .description("Advance a subscription to its next billing period")
    .action(async function (this: Command, id: string) {
      const ctx = buildContext(this);
      const sub = await ctx.client.post<Subscription>(
        `/v1/subscriptions/${encodeURIComponent(id)}/renew`,
      );
      ctx.printRecord(sub);
    });

  subscriptions
    .command("cancel <id>")
    .description("Cancel a subscription")
    .action(async function (this: Command, id: string) {
      const ctx = buildContext(this);
      const sub = await ctx.client.post<Subscription>(
        `/v1/subscriptions/${encodeURIComponent(id)}/cancel`,
      );
      ctx.printRecord(sub);
    });
}
