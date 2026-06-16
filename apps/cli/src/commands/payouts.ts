/**
 * `settlekit payouts` — merchant settlement payouts.
 *
 *   list                 GET  /v1/payouts
 *   create               POST /v1/payouts
 *   paid <id>            POST /v1/payouts/:id/paid
 */
import type { Command } from "commander";
import { buildContext } from "../context.js";
import type { Money } from "../api.js";

interface Payout extends Record<string, unknown> {
  id: string;
  walletAddress: string;
  amount: Money;
  network: string;
  status: string;
}

export function registerPayouts(program: Command): void {
  const payouts = program.command("payouts").description("Merchant settlement payouts");

  payouts
    .command("list")
    .description("List payouts")
    .option("--organization-id <id>", "Filter by organization")
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const rows = await ctx.client.get<Payout[]>(
        "/v1/payouts",
        opts.organizationId ? { organizationId: opts.organizationId } : undefined,
      );
      ctx.printList(rows, [
        { header: "ID", value: (p) => p.id },
        { header: "WALLET", value: (p) => p.walletAddress },
        { header: "AMOUNT", value: (p) => p.amount },
        { header: "NETWORK", value: (p) => p.network },
        { header: "STATUS", value: (p) => p.status },
      ]);
    });

  payouts
    .command("create")
    .description("Create a payout (must be within available balance)")
    .requiredOption("--organization-id <id>", "Organization id")
    .requiredOption("--wallet-address <addr>", "Destination wallet address")
    .requiredOption("--amount <amount>", "Amount, e.g. 100.00")
    .option("--network <network>", "arc | base | ethereum", "arc")
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const payout = await ctx.client.post<Payout>("/v1/payouts", {
        organizationId: opts.organizationId,
        walletAddress: opts.walletAddress,
        amount: opts.amount,
        network: opts.network,
      });
      ctx.printRecord(payout);
    });

  payouts
    .command("paid <id>")
    .description("Mark a payout paid with an on-chain tx hash")
    .requiredOption("--tx-hash <hash>", "On-chain transaction hash")
    .action(async function (this: Command, id: string) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const payout = await ctx.client.post<Payout>(`/v1/payouts/${encodeURIComponent(id)}/paid`, {
        txHash: opts.txHash,
      });
      ctx.printRecord(payout);
    });
}
