/**
 * `settlekit coupons` — manage discount coupons.
 *
 *   list                 GET  /v1/coupons
 *   create               POST /v1/coupons
 *   validate <code>      POST /v1/coupons/:code/validate
 *   redeem <code>        POST /v1/coupons/:code/redeem
 */
import type { Command } from "commander";
import { buildContext } from "../context.js";
import type { Money } from "../api.js";

interface Coupon extends Record<string, unknown> {
  code: string;
  status: string;
  redeemedCount: number;
}

/** Build the discount payload from the --percent-off / --amount-off / --free-trial-days flags. */
function buildDiscount(opts: Record<string, unknown>): Record<string, unknown> {
  if (opts.percentOff !== undefined) return { type: "percent", percentOff: opts.percentOff };
  if (opts.amountOff !== undefined) return { type: "amount", amountOff: opts.amountOff };
  if (opts.freeTrialDays !== undefined) return { type: "free-trial-days", days: opts.freeTrialDays };
  throw new Error("Provide one of --percent-off, --amount-off, or --free-trial-days.");
}

export function registerCoupons(program: Command): void {
  const coupons = program.command("coupons").description("Manage discount coupons");

  coupons
    .command("list")
    .description("List coupons")
    .action(async function (this: Command) {
      const ctx = buildContext(this);
      const rows = await ctx.client.get<Coupon[]>("/v1/coupons");
      ctx.printList(rows, [
        { header: "CODE", value: (c) => c.code },
        { header: "STATUS", value: (c) => c.status },
        { header: "REDEEMED", value: (c) => c.redeemedCount },
      ]);
    });

  coupons
    .command("create")
    .description("Create a coupon")
    .requiredOption("--code <code>", "Coupon code")
    .option("--name <name>", "Display name")
    .option("--percent-off <n>", "Percent discount (1-100)", (v) => Number.parseInt(v, 10))
    .option("--amount-off <amount>", "Fixed amount off, e.g. 5.00")
    .option("--free-trial-days <n>", "Free trial days", (v) => Number.parseInt(v, 10))
    .option("--max-redemptions <n>", "Global redemption cap", (v) => Number.parseInt(v, 10))
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const body: Record<string, unknown> = { code: opts.code, discount: buildDiscount(opts) };
      if (opts.name) body.name = opts.name;
      if (opts.maxRedemptions !== undefined) body.maxRedemptions = opts.maxRedemptions;
      const coupon = await ctx.client.post<Coupon>("/v1/coupons", body);
      ctx.printRecord(coupon);
    });

  coupons
    .command("validate <code>")
    .description("Dry-run apply a coupon to a subtotal")
    .requiredOption("--subtotal <amount>", "Subtotal, e.g. 100.00")
    .option("--customer-id <id>", "Customer id (for per-customer limits)")
    .action(async function (this: Command, code: string) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const body: Record<string, unknown> = { subtotal: opts.subtotal };
      if (opts.customerId) body.customerId = opts.customerId;
      const result = await ctx.client.post<{ ok: boolean; discount: Money; total: Money }>(
        `/v1/coupons/${encodeURIComponent(code)}/validate`,
        body,
      );
      ctx.printRecord(result as unknown as Record<string, unknown>);
    });

  coupons
    .command("redeem <code>")
    .description("Redeem a coupon against a subtotal")
    .requiredOption("--subtotal <amount>", "Subtotal, e.g. 100.00")
    .option("--customer-id <id>", "Customer id")
    .action(async function (this: Command, code: string) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const body: Record<string, unknown> = { subtotal: opts.subtotal };
      if (opts.customerId) body.customerId = opts.customerId;
      const result = await ctx.client.post<Record<string, unknown>>(
        `/v1/coupons/${encodeURIComponent(code)}/redeem`,
        body,
      );
      ctx.printRecord(result);
    });
}
