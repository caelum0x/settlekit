/**
 * `settlekit dunning` — recover failed subscription payments.
 *
 *   list                        GET  /v1/dunning?due=
 *   start <subscriptionId>     POST /v1/dunning
 *   attempt <subscriptionId>   POST /v1/dunning/:id/attempt
 *   recover <subscriptionId>   POST /v1/dunning/:id/recover
 */
import type { Command } from "commander";
import { buildContext } from "../context.js";

const OUTCOMES = ["recovered", "failed"] as const;

interface DunningState extends Record<string, unknown> {
  subscriptionId: string;
  attempt: number;
  status: string;
  nextAttemptAt?: string;
}

const DUNNING_COLUMNS = [
  { header: "SUBSCRIPTION", value: (d: DunningState) => d.subscriptionId },
  { header: "STATUS", value: (d: DunningState) => d.status },
  { header: "ATTEMPT", value: (d: DunningState) => d.attempt },
  { header: "NEXT", value: (d: DunningState) => d.nextAttemptAt },
];

export function registerDunning(program: Command): void {
  const dunning = program.command("dunning").description("Recover failed subscription payments");

  dunning
    .command("list")
    .description("List active dunning campaigns (or only those due)")
    .option("--due", "Only campaigns with an attempt currently due", false)
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const rows = await ctx.client.get<DunningState[]>("/v1/dunning", {
        due: opts.due ? "true" : undefined,
      });
      ctx.printList(rows, DUNNING_COLUMNS);
    });

  dunning
    .command("start <subscriptionId>")
    .description("Start a dunning campaign for a subscription with a failed payment")
    .action(async function (this: Command, subscriptionId: string) {
      const ctx = buildContext(this);
      const state = await ctx.client.post<DunningState>("/v1/dunning", { subscriptionId });
      ctx.printRecord(state);
    });

  dunning
    .command("attempt <subscriptionId>")
    .description("Record an attempt outcome (recovered closes; failed advances)")
    .requiredOption("--outcome <outcome>", `Attempt outcome (${OUTCOMES.join(" | ")})`)
    .option("--failure-reason <reason>", "Reason when the outcome is 'failed'")
    .action(async function (this: Command, subscriptionId: string) {
      const opts = this.opts();
      if (!OUTCOMES.includes(opts.outcome)) {
        throw new Error(`--outcome must be one of: ${OUTCOMES.join(", ")}`);
      }
      const ctx = buildContext(this);
      const body: Record<string, unknown> = { outcome: opts.outcome };
      if (opts.failureReason) body.failureReason = opts.failureReason;
      const state = await ctx.client.post<DunningState>(
        `/v1/dunning/${encodeURIComponent(subscriptionId)}/attempt`,
        body,
      );
      ctx.printRecord(state);
    });

  dunning
    .command("recover <subscriptionId>")
    .description("Mark a subscription's dunning campaign as recovered")
    .action(async function (this: Command, subscriptionId: string) {
      const ctx = buildContext(this);
      const state = await ctx.client.post<DunningState>(
        `/v1/dunning/${encodeURIComponent(subscriptionId)}/recover`,
      );
      ctx.printRecord(state);
    });
}
