/**
 * `lepton settlements` — inspect Lepton settlement receipts in Postgres.
 *
 *   list [--status ...]   listByStatus via the Pg idempotency store
 *   inspect <reference>   get one receipt by its business reference
 *
 * Reads through @settlekit/persistence PgIdempotencyStore over a Database built
 * from DATABASE_URL. Uses createConnection so the postgres-js pool is closed
 * after the query (otherwise the process would hang).
 */
import type { Command } from "commander";
import { createConnection } from "@settlekit/database";
import { PgIdempotencyStore } from "@settlekit/persistence";
import type {
  SettlementReceipt,
  SettlementStatus,
} from "@settlekit/settlement-core";
import { buildContext, type CommandContext } from "../context.js";
import { requireDatabaseUrl } from "../env.js";
import type { Column } from "../output.js";

/** The four valid settlement statuses. */
export const SETTLEMENT_STATUSES: readonly SettlementStatus[] = [
  "pending",
  "submitted",
  "settled",
  "failed",
];

/** Validate a `--status` flag against the four SettlementStatus literals. */
export function parseStatus(value: string): SettlementStatus {
  if ((SETTLEMENT_STATUSES as readonly string[]).includes(value)) {
    return value as SettlementStatus;
  }
  throw new Error(
    `Invalid --status "${value}". Expected one of: ${SETTLEMENT_STATUSES.join(", ")}.`,
  );
}

/** Table columns for a settlement receipt row. */
export function receiptColumns(): ReadonlyArray<Column<SettlementReceipt>> {
  return [
    { header: "ID", value: (r) => r.id },
    { header: "REFERENCE", value: (r) => r.reference },
    { header: "TO", value: (r) => r.to },
    { header: "AMOUNT", value: (r) => r.amount },
    { header: "NETWORK", value: (r) => r.network },
    { header: "STATUS", value: (r) => r.status },
    { header: "PROVIDER", value: (r) => r.provider },
    { header: "TXHASH", value: (r) => r.txHash },
  ];
}

/** A receipt typed so it satisfies the printList Record constraint. */
type ReceiptRow = SettlementReceipt & Record<string, unknown>;

/** Render receipts honoring the --json flag, without the Record constraint. */
function printReceipts(ctx: CommandContext, rows: readonly SettlementReceipt[]): void {
  ctx.printList(rows as unknown as readonly ReceiptRow[], receiptColumns());
}

export function registerSettlements(program: Command): void {
  const settlements = program
    .command("settlements")
    .description("Inspect Lepton settlement receipts");

  settlements
    .command("list")
    .description("List receipts by status (default: settled)")
    .option("--status <status>", `Status (${SETTLEMENT_STATUSES.join(" | ")})`, "settled")
    .action(async function (this: Command) {
      const flags = this.opts<{ status: string }>();
      const ctx = buildContext(this);
      const status = parseStatus(flags.status);
      const dbUrl = requireDatabaseUrl();

      const conn = createConnection(dbUrl);
      try {
        const store = new PgIdempotencyStore(conn.db);
        const rows = await store.listByStatus(status);
        printReceipts(ctx, rows);
      } finally {
        await conn.close();
      }
    });

  settlements
    .command("inspect")
    .description("Inspect a single receipt by its business reference")
    .argument("<reference>", "Settlement business reference (idempotency key)")
    .action(async function (this: Command, reference: string) {
      const ctx = buildContext(this);
      if (reference.trim() === "") {
        throw new Error("reference must not be empty.");
      }
      const dbUrl = requireDatabaseUrl();

      const conn = createConnection(dbUrl);
      try {
        const store = new PgIdempotencyStore(conn.db);
        const receipt = await store.get(reference);
        if (receipt === undefined) {
          throw new Error(`No settlement receipt found for reference: ${reference}`);
        }
        ctx.printRecord(receipt as unknown as Record<string, unknown>);
      } finally {
        await conn.close();
      }
    });
}
