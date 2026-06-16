/**
 * `settlekit checkout` — build and inspect checkout sessions.
 *
 * Subcommands:
 *   create    POST /v1/checkout-sessions
 *   get <id>  GET  /v1/checkout-sessions/:id
 *
 * Line items are supplied with repeatable `--item priceId[:productId][:quantity]`
 * flags, e.g. `--item price_123:prod_9:2`.
 */
import type { Command } from "commander";
import { buildContext } from "../context.js";

interface LineItem {
  priceId: string;
  productId?: string;
  quantity: number;
}

interface CheckoutSession extends Record<string, unknown> {
  id: string;
  status: string;
  network: string;
  total?: { amount: string; currency: string };
}

/** Collect repeated `--item` flags into a list. */
function collectItem(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** Parse `priceId[:productId][:quantity]` into a structured line item. */
function parseItem(raw: string): LineItem {
  const parts = raw.split(":");
  const priceId = parts[0]?.trim();
  if (!priceId) {
    throw new Error(`Invalid --item "${raw}": priceId is required.`);
  }
  const item: LineItem = { priceId, quantity: 1 };
  if (parts[1] && parts[1].trim().length > 0) item.productId = parts[1].trim();
  if (parts[2] && parts[2].trim().length > 0) {
    const qty = Number.parseInt(parts[2], 10);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error(`Invalid quantity in --item "${raw}": must be a positive integer.`);
    }
    item.quantity = qty;
  }
  return item;
}

export function registerCheckout(program: Command): void {
  const checkout = program.command("checkout").description("Build and inspect checkout sessions");

  checkout
    .command("create")
    .description("Create a checkout session")
    .requiredOption("--organization-id <id>", "Organization id")
    .requiredOption("--merchant-id <id>", "Merchant id")
    .requiredOption("--customer-id <id>", "Customer id")
    .requiredOption("--pay-to <address>", "Destination wallet address")
    .requiredOption("--network <network>", "arc | base | ethereum")
    .requiredOption(
      "--item <priceId[:productId][:quantity]>",
      "Line item; repeatable",
      collectItem,
      [],
    )
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const items = (opts.item as string[]).map(parseItem);
      if (items.length === 0) {
        throw new Error("At least one --item is required.");
      }
      const session = await ctx.client.post<CheckoutSession>("/v1/checkout-sessions", {
        organizationId: opts.organizationId,
        merchantId: opts.merchantId,
        customerId: opts.customerId,
        items: items.map((item) => ({
          priceId: item.priceId,
          ...(item.productId !== undefined ? { productId: item.productId } : {}),
          quantity: item.quantity,
        })),
        payToAddress: opts.payTo,
        network: opts.network,
      });
      ctx.printRecord(session);
    });

  checkout
    .command("get <id>")
    .description("Get a checkout session by id")
    .action(async function (this: Command, id: string) {
      const ctx = buildContext(this);
      const session = await ctx.client.get<CheckoutSession>(
        `/v1/checkout-sessions/${encodeURIComponent(id)}`,
      );
      ctx.printRecord(session);
    });
}
