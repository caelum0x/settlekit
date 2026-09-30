/**
 * Monthly platform fee statements.
 *
 * Buyers pay the merchant's own wallet directly, so SettleKit's per-payment
 * fee cannot be skimmed at settlement. Instead each merchant receives a
 * monthly statement: every confirmed payment in the coverage window times the
 * fee schedule. The statement is issued as an invoice from SettleKit's own
 * organization and paid through SettleKit's own checkout.
 *
 * Coverage carries forward: a month whose fees fall below the minimum is not
 * billed, and its payments roll into the next statement (nothing is lost).
 *
 * Pure functions only.
 */
import { addMoney, money, toBaseUnits, type Money, type Payment } from "@settlekit/common";
import { applicationFee, normalizeSchedule } from "./fees.js";
import type { PlatformFeeSchedule } from "./types.js";

/** A billing month, `YYYY-MM` (UTC). */
export type BillingPeriod = string;

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isBillingPeriod(value: string): value is BillingPeriod {
  return PERIOD_RE.test(value);
}

/** UTC [start, end) of a billing month. */
export function periodBounds(period: BillingPeriod): { start: Date; end: Date } {
  const match = PERIOD_RE.exec(period);
  if (!match) throw new Error(`billing period must be YYYY-MM, got ${period}`);
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  return { start: new Date(Date.UTC(year, month, 1)), end: new Date(Date.UTC(year, month + 1, 1)) };
}

/** The month before `now` (the period a statement run bills by default). */
export function previousPeriod(now: Date): BillingPeriod {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** When a payment settled (confirmation time, else creation). */
function settledAt(payment: Payment): Date {
  return new Date(payment.confirmedAt ?? payment.createdAt);
}

export interface FeeStatementInput {
  payments: readonly Payment[];
  schedule: PlatformFeeSchedule;
  /** Inclusive start of coverage (end of the last issued statement). */
  coverageStart: Date;
  /** Exclusive end of coverage (end of the billed period). */
  coverageEnd: Date;
}

export interface FeeStatement {
  coverageStart: string;
  coverageEnd: string;
  paymentCount: number;
  grossVolume: Money;
  fees: Money;
  schedule: PlatformFeeSchedule;
  /** Payment ids billed by this statement (audit trail). */
  paymentIds: string[];
}

/** Fees owed for confirmed payments settled in [coverageStart, coverageEnd). */
export function buildFeeStatement(input: FeeStatementInput): FeeStatement {
  if (input.coverageEnd.getTime() <= input.coverageStart.getTime()) {
    throw new Error("coverage end must be after coverage start");
  }
  const schedule = normalizeSchedule(input.schedule);
  const covered = input.payments.filter((p) => {
    if (p.status !== "confirmed") return false;
    const at = settledAt(p).getTime();
    return at >= input.coverageStart.getTime() && at < input.coverageEnd.getTime();
  });
  const zero = money("0");
  return {
    coverageStart: input.coverageStart.toISOString(),
    coverageEnd: input.coverageEnd.toISOString(),
    paymentCount: covered.length,
    grossVolume: covered.reduce((sum, p) => addMoney(sum, money(p.amount.amount)), zero),
    fees: covered.reduce((sum, p) => addMoney(sum, applicationFee(money(p.amount.amount), schedule)), zero),
    schedule,
    paymentIds: covered.map((p) => p.id),
  };
}

/** Whether a statement's fees reach the billing minimum. */
export function meetsMinimum(statement: FeeStatement, minimum: string): boolean {
  const fees = toBaseUnits(statement.fees.amount);
  return fees > 0n && fees >= toBaseUnits(minimum);
}

/** Human line for the statement invoice. */
export function statementDescription(statement: FeeStatement, period: BillingPeriod): string {
  const pct = (statement.schedule.bps / 100).toFixed(2).replace(/\.?0+$/, "");
  const fixed = toBaseUnits(statement.schedule.fixed) > 0n ? ` + ${statement.schedule.fixed} per payment` : "";
  return `SettleKit fees ${period}: ${statement.paymentCount} payments, ${statement.grossVolume.amount} USDC volume at ${pct}%${fixed}`;
}

/** Account standing derived from unpaid fee statements. */
export type BillingStanding = "good" | "due" | "past_due" | "restricted";

export interface StatementDue {
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
  dueAt?: string;
}

/**
 * `good` (nothing open), `due` (open, not yet due), `past_due` (inside the
 * grace window), `restricted` (unpaid past due + grace: plan limits apply).
 */
export function billingStanding(statements: readonly StatementDue[], now: Date, graceDays: number): BillingStanding {
  let standing: BillingStanding = "good";
  const rank: Record<BillingStanding, number> = { good: 0, due: 1, past_due: 2, restricted: 3 };
  for (const s of statements) {
    if (s.status !== "open") continue;
    const due = s.dueAt ? new Date(s.dueAt).getTime() : Number.NaN;
    let next: BillingStanding = "due";
    if (!Number.isNaN(due) && now.getTime() > due) {
      next = now.getTime() > due + graceDays * 86_400_000 ? "restricted" : "past_due";
    }
    if (rank[next] > rank[standing]) standing = next;
  }
  return standing;
}
