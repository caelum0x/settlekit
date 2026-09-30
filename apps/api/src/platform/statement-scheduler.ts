/**
 * Runs the monthly fee statements without an operator click: shortly after
 * boot and then every few hours, the API issues the previous month's
 * statements (idempotent per merchant and period: runs in one process are
 * serialized, and a duplicate raced in by another instance is voided before
 * it is sent). Only active when platform billing is
 * configured; `PLATFORM_BILLING_AUTORUN=0` turns it off.
 */
import { previousPeriod } from "@settlekit/platform-billing";
import type { AppContext } from "../context.js";
import { loadPlatformBillingConfig, runStatements, type StatementRunResult } from "./fee-statements.js";

export const STATEMENT_TICK_MS = 6 * 60 * 60 * 1000;
const FIRST_TICK_MS = 60 * 1000;

type Log = (message: string, fields?: Record<string, unknown>) => void;

/** One scheduler tick: bill last month if needed. Null when not configured. */
export async function statementTick(ctx: AppContext, now: Date = new Date()): Promise<StatementRunResult | null> {
  const cfg = loadPlatformBillingConfig();
  if (!cfg) return null;
  return runStatements(ctx, cfg, previousPeriod(now), now);
}

/** Start the timer; returns a stop function (no-op when disabled). */
export function startStatementScheduler(ctx: AppContext, log: Log, env: NodeJS.ProcessEnv = process.env): () => void {
  if (!loadPlatformBillingConfig(env) || env.PLATFORM_BILLING_AUTORUN === "0") return () => {};
  const tick = async (): Promise<void> => {
    try {
      const result = await statementTick(ctx);
      if (!result) return;
      const issued = result.results.filter((r) => r.status === "issued").length;
      const errors = result.results.filter((r) => r.status === "error");
      log("platform fee statements", { period: result.period, issued, errors: errors.length });
      for (const e of errors) log("platform fee statement failed", { ...e });
    } catch (error) {
      log("platform fee statements failed", { error: error instanceof Error ? error.message : String(error) });
    }
  };
  const first = setTimeout(() => void tick(), FIRST_TICK_MS);
  const every = setInterval(() => void tick(), STATEMENT_TICK_MS);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
