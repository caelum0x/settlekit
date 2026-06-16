/**
 * `settlekit payments` — record and confirm payments.
 *
 *   create               POST /v1/payments
 *   confirm <id>         POST /v1/payments/:id/confirm
 *   refund <id>          POST /v1/payments/:id/refund
 *   get <id>             GET  /v1/payments/:id
 */
import type { Command } from "commander";
import { buildContext } from "../context.js";

export function registerPayments(program: Command): void {
  const payments = program.command("payments").description("Record and confirm payments");

  payments
    .command("create")
    .description("Record a pending payment for a checkout session")
    .requiredOption("--checkout-session-id <id>", "Checkout session id")
    .option("--tx-hash <hash>", "On-chain transaction hash")
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const body: Record<string, unknown> = { checkoutSessionId: opts.checkoutSessionId };
      if (opts.txHash) body.txHash = opts.txHash;
      const payment = await ctx.client.post<Record<string, unknown>>("/v1/payments", body);
      ctx.printRecord(payment);
    });

  payments
    .command("confirm <id>")
    .description("Confirm a payment (verifies on-chain when Arc is configured)")
    .requiredOption("--tx-hash <hash>", "On-chain transaction hash")
    .option("--confirmations <n>", "Observed confirmations", (v) => Number.parseInt(v, 10), 1)
    .option("--min-confirmations <n>", "Required confirmations", (v) => Number.parseInt(v, 10))
    .action(async function (this: Command, id: string) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const body: Record<string, unknown> = { txHash: opts.txHash, confirmations: opts.confirmations };
      if (opts.minConfirmations !== undefined) body.minConfirmations = opts.minConfirmations;
      const result = await ctx.client.post<Record<string, unknown>>(
        `/v1/payments/${encodeURIComponent(id)}/confirm`,
        body,
      );
      ctx.printRecord(result);
    });

  payments
    .command("refund <id>")
    .description("Refund a confirmed payment")
    .action(async function (this: Command, id: string) {
      const ctx = buildContext(this);
      const result = await ctx.client.post<Record<string, unknown>>(
        `/v1/payments/${encodeURIComponent(id)}/refund`,
      );
      ctx.printRecord(result);
    });

  payments
    .command("get <id>")
    .description("Get a payment by id")
    .action(async function (this: Command, id: string) {
      const ctx = buildContext(this);
      const payment = await ctx.client.get<Record<string, unknown>>(`/v1/payments/${encodeURIComponent(id)}`);
      ctx.printRecord(payment);
    });
}
