/**
 * `settlekit refunds` — issue and settle refunds.
 *
 *   list                 GET  /v1/refunds?paymentId=&customerId=
 *   create               POST /v1/refunds
 *   succeed <id>        POST /v1/refunds/:id/succeed
 *   fail <id>           POST /v1/refunds/:id/fail
 *
 * A refund is created in `pending` against the original payment, then settled
 * with `succeed` (or `fail`). The backing payment bounds the refundable amount.
 */
import type { Command } from "commander";
import { buildContext } from "../context.js";
import type { Money } from "../api.js";

const REFUND_REASONS = ["duplicate", "fraudulent", "customer_request", "delivery_failed"] as const;

interface Refund extends Record<string, unknown> {
  id: string;
  paymentId: string;
  status: string;
  amount?: Money;
  reason?: string;
}

const REFUND_COLUMNS = [
  { header: "ID", value: (r: Refund) => r.id },
  { header: "PAYMENT", value: (r: Refund) => r.paymentId },
  { header: "AMOUNT", value: (r: Refund) => r.amount },
  { header: "STATUS", value: (r: Refund) => r.status },
  { header: "REASON", value: (r: Refund) => r.reason },
];

export function registerRefunds(program: Command): void {
  const refunds = program.command("refunds").description("Issue and settle refunds");

  refunds
    .command("list")
    .description("List refunds by payment or customer")
    .option("--payment-id <id>", "Filter by payment")
    .option("--customer-id <id>", "Filter by customer")
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const rows = await ctx.client.get<Refund[]>("/v1/refunds", {
        paymentId: opts.paymentId,
        customerId: opts.customerId,
      });
      ctx.printList(rows, REFUND_COLUMNS);
    });

  refunds
    .command("create")
    .description("Create a pending refund against a payment")
    .requiredOption("--payment-id <id>", "Payment being refunded")
    .requiredOption("--customer-id <id>", "Customer id")
    .requiredOption("--amount <amount>", "Refund amount, e.g. 10.00")
    .requiredOption(
      "--reason <reason>",
      `Refund reason (${REFUND_REASONS.join(" | ")})`,
    )
    .action(async function (this: Command) {
      const opts = this.opts();
      if (!REFUND_REASONS.includes(opts.reason)) {
        throw new Error(`--reason must be one of: ${REFUND_REASONS.join(", ")}`);
      }
      const ctx = buildContext(this);
      const refund = await ctx.client.post<Refund>("/v1/refunds", {
        paymentId: opts.paymentId,
        customerId: opts.customerId,
        amount: opts.amount,
        reason: opts.reason,
      });
      ctx.printRecord(refund);
    });

  refunds
    .command("succeed <id>")
    .description("Mark a pending refund as succeeded")
    .action(async function (this: Command, id: string) {
      const ctx = buildContext(this);
      const refund = await ctx.client.post<Refund>(
        `/v1/refunds/${encodeURIComponent(id)}/succeed`,
      );
      ctx.printRecord(refund);
    });

  refunds
    .command("fail <id>")
    .description("Mark a pending refund as failed")
    .option("--reason <reason>", "Failure reason")
    .action(async function (this: Command, id: string) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const body: Record<string, unknown> = {};
      if (opts.reason) body.reason = opts.reason;
      const refund = await ctx.client.post<Refund>(
        `/v1/refunds/${encodeURIComponent(id)}/fail`,
        body,
      );
      ctx.printRecord(refund);
    });
}
