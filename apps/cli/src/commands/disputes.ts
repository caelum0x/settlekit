/**
 * `settlekit disputes` — open, evidence, and resolve payment disputes.
 *
 *   list                 GET  /v1/disputes?status=
 *   open                 POST /v1/disputes
 *   get <id>            GET  /v1/disputes/:id
 *   evidence <id>       POST /v1/disputes/:id/evidence
 *   resolve <id>        POST /v1/disputes/:id/resolve
 */
import type { Command } from "commander";
import { buildContext } from "../context.js";

const REASONS = ["fraud", "not_received", "duplicate", "quality", "unrecognized"] as const;
const EVIDENCE_KINDS = ["text", "receipt", "shipping", "communication", "url", "file"] as const;
const OUTCOMES = ["won", "lost", "refunded"] as const;

interface Dispute extends Record<string, unknown> {
  id: string;
  paymentId: string;
  customerId: string;
  reason: string;
  status: string;
}

export function registerDisputes(program: Command): void {
  const disputes = program.command("disputes").description("Open, evidence, and resolve disputes");

  disputes
    .command("list")
    .description("List disputes, optionally filtered by status")
    .option("--status <status>", "Filter by status (open, under_review, won, lost, refunded)")
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const rows = await ctx.client.get<Dispute[]>("/v1/disputes", { status: opts.status });
      ctx.printList(rows, [
        { header: "ID", value: (d) => d.id },
        { header: "PAYMENT", value: (d) => d.paymentId },
        { header: "REASON", value: (d) => d.reason },
        { header: "STATUS", value: (d) => d.status },
      ]);
    });

  disputes
    .command("open")
    .description("Open a dispute against a payment")
    .requiredOption("--payment-id <id>", "Disputed payment id")
    .requiredOption("--customer-id <id>", "Customer id")
    .requiredOption("--reason <reason>", `Dispute reason (${REASONS.join(" | ")})`)
    .action(async function (this: Command) {
      const opts = this.opts();
      if (!REASONS.includes(opts.reason)) {
        throw new Error(`--reason must be one of: ${REASONS.join(", ")}`);
      }
      const ctx = buildContext(this);
      const dispute = await ctx.client.post<Dispute>("/v1/disputes", {
        paymentId: opts.paymentId,
        customerId: opts.customerId,
        reason: opts.reason,
      });
      ctx.printRecord(dispute);
    });

  disputes
    .command("get <id>")
    .description("Fetch a single dispute")
    .action(async function (this: Command, id: string) {
      const ctx = buildContext(this);
      const dispute = await ctx.client.get<Dispute>(`/v1/disputes/${encodeURIComponent(id)}`);
      ctx.printRecord(dispute);
    });

  disputes
    .command("evidence <id>")
    .description("Attach evidence to a dispute")
    .requiredOption("--kind <kind>", `Evidence kind (${EVIDENCE_KINDS.join(" | ")})`)
    .requiredOption("--description <text>", "Human description of the evidence")
    .requiredOption("--value <value>", "URL, file key, or inline note")
    .action(async function (this: Command, id: string) {
      const opts = this.opts();
      if (!EVIDENCE_KINDS.includes(opts.kind)) {
        throw new Error(`--kind must be one of: ${EVIDENCE_KINDS.join(", ")}`);
      }
      const ctx = buildContext(this);
      const dispute = await ctx.client.post<Dispute>(
        `/v1/disputes/${encodeURIComponent(id)}/evidence`,
        { kind: opts.kind, description: opts.description, value: opts.value },
      );
      ctx.printRecord(dispute);
    });

  disputes
    .command("resolve <id>")
    .description("Resolve a dispute with an outcome")
    .requiredOption("--outcome <outcome>", `Resolution (${OUTCOMES.join(" | ")})`)
    .action(async function (this: Command, id: string) {
      const opts = this.opts();
      if (!OUTCOMES.includes(opts.outcome)) {
        throw new Error(`--outcome must be one of: ${OUTCOMES.join(", ")}`);
      }
      const ctx = buildContext(this);
      const dispute = await ctx.client.post<Dispute>(
        `/v1/disputes/${encodeURIComponent(id)}/resolve`,
        { outcome: opts.outcome },
      );
      ctx.printRecord(dispute);
    });
}
