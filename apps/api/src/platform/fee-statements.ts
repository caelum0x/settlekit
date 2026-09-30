/**
 * SettleKit's own revenue: monthly platform fee statements.
 *
 * Buyers pay merchants' wallets directly, so the per-payment fee advertised on
 * the pricing page is collected as a monthly statement: confirmed payments in
 * the coverage window x the platform fee schedule, issued as an invoice from
 * SettleKit's own organization (`PLATFORM_BILLING_ORG_ID`) and paid through
 * SettleKit's own checkout (the same payable-invoice path merchants use).
 *
 * A merchant whose statement stays unpaid past its due date plus the grace
 * period is `restricted`: the free plan's product limit (packages/pricing)
 * applies until it is paid. Nothing is enforced while platform billing is not
 * configured, so local runs and demo deployments behave exactly as before.
 */
import { money, SettleKitError, type Customer } from "@settlekit/common";
import { canCreateProduct, HOSTED_PLAN_LIMITS } from "@settlekit/pricing";
import {
  billingStanding,
  buildFeeStatement,
  isBillingPeriod,
  meetsMinimum,
  periodBounds,
  statementDescription,
  type BillingPeriod,
  type BillingStanding,
  type FeeStatement,
} from "@settlekit/platform-billing";
import { payTokenOf, type Invoice } from "@settlekit/invoices";
import { generateId } from "@settlekit/common";
import type { AppContext } from "../context.js";
import { isInvoiceProduct, payUrlFor, reconcileInvoiceWithPayments, sendInvoice } from "../merchant/invoice-payments.js";

export const FEE_STATEMENT_KIND = "platform_fee";

export interface PlatformBillingConfig {
  /** SettleKit's own organization: issues statements and receives fee payments. */
  orgId: string;
  /** Days after the period end a statement is due. */
  dueDays: number;
  /** Days after the due date before plan limits apply. */
  graceDays: number;
  /** Statements below this fee total are not issued (fees carry forward). */
  minimum: string;
}

function intEnv(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${key} must be an integer in [${min}, ${max}]`);
  return n;
}

/** Platform billing config, or null when `PLATFORM_BILLING_ORG_ID` is unset. */
export function loadPlatformBillingConfig(env: NodeJS.ProcessEnv = process.env): PlatformBillingConfig | null {
  const orgId = env.PLATFORM_BILLING_ORG_ID?.trim();
  if (!orgId) return null;
  const minimum = env.PLATFORM_BILLING_MIN_USD?.trim() || "1";
  if (!/^\d+(\.\d{1,6})?$/.test(minimum)) throw new Error("PLATFORM_BILLING_MIN_USD must be a decimal amount");
  return {
    orgId,
    dueDays: intEnv(env, "PLATFORM_BILLING_DUE_DAYS", 14, 0, 90),
    graceDays: intEnv(env, "PLATFORM_BILLING_GRACE_DAYS", 14, 0, 180),
    minimum,
  };
}

/**
 * Every non-void fee statement issued to a merchant org, oldest first. Open
 * statements are reconciled against their checkout sessions first, so a
 * statement paid a moment ago already reads as paid.
 */
export async function statementsFor(ctx: AppContext, cfg: PlatformBillingConfig, merchantOrgId: string): Promise<Invoice[]> {
  const all = await ctx.invoices.list();
  const mine = all.filter(
    (inv) =>
      inv.organizationId === cfg.orgId &&
      inv.metadata.kind === FEE_STATEMENT_KIND &&
      inv.metadata.merchantOrgId === merchantOrgId &&
      inv.status !== "void",
  );
  const current = await Promise.all(mine.map((inv) => reconcileInvoiceWithPayments(ctx, inv)));
  return current.sort((a, b) => (a.metadata.coverageEnd ?? "").localeCompare(b.metadata.coverageEnd ?? ""));
}

/** Coverage starts where the last issued statement ended (epoch when none). */
function coverageStartOf(statements: readonly Invoice[]): Date {
  const last = statements[statements.length - 1]?.metadata.coverageEnd;
  return last ? new Date(last) : new Date(0);
}

/** The platform-org customer that represents a merchant org (created once). */
async function merchantCustomer(ctx: AppContext, cfg: PlatformBillingConfig, merchantOrgId: string): Promise<Customer> {
  const [existing] = await ctx.customers.list(
    (c) => c.organizationId === cfg.orgId && c.metadata.merchantOrgId === merchantOrgId,
  );
  const settings = await ctx.orgSettings.get(merchantOrgId);
  if (existing) {
    if (settings.supportEmail && existing.email !== settings.supportEmail) {
      return ctx.customers.save({ ...existing, email: settings.supportEmail, name: settings.orgName });
    }
    return existing;
  }
  return ctx.customers.save({
    id: generateId("customer"),
    organizationId: cfg.orgId,
    email: settings.supportEmail,
    name: settings.orgName,
    metadata: { merchantOrgId, source: "platform_billing" },
    createdAt: new Date().toISOString(),
  });
}

/** Fees accrued since the last statement (the current, unbilled window). */
export async function accruedFees(
  ctx: AppContext,
  cfg: PlatformBillingConfig | null,
  merchantOrgId: string,
  now: Date,
): Promise<FeeStatement> {
  const statements = cfg ? await statementsFor(ctx, cfg, merchantOrgId) : [];
  const start = coverageStartOf(statements);
  return buildFeeStatement({
    payments: await ctx.payments.findConfirmedByOrganization(merchantOrgId),
    schedule: ctx.platformFeeSchedule,
    coverageStart: start,
    coverageEnd: new Date(Math.max(now.getTime(), start.getTime() + 1)),
  });
}

export type StatementOutcome =
  | { status: "issued"; invoice: Invoice; payUrl: string; emailedTo: string | null }
  | { status: "exists"; invoice: Invoice }
  | { status: "below_minimum"; fees: string };

/**
 * Issue a merchant's statement for a closed month. Idempotent per
 * (merchant, period); fees below the minimum carry into the next statement.
 */
export async function issueStatement(
  ctx: AppContext,
  cfg: PlatformBillingConfig,
  merchantOrgId: string,
  period: BillingPeriod,
  now: Date = new Date(),
): Promise<StatementOutcome> {
  if (!isBillingPeriod(period)) throw new SettleKitError({ code: "validation_error", message: "period must be YYYY-MM" });
  const { end } = periodBounds(period);
  if (end.getTime() > now.getTime()) {
    throw new SettleKitError({ code: "validation_error", message: `period ${period} has not ended yet` });
  }
  const statements = await statementsFor(ctx, cfg, merchantOrgId);
  const existing = statements.find((s) => s.metadata.period === period);
  if (existing) return { status: "exists", invoice: existing };

  const start = coverageStartOf(statements);
  if (start.getTime() >= end.getTime()) return { status: "below_minimum", fees: "0" };
  const statement = buildFeeStatement({
    payments: await ctx.payments.findConfirmedByOrganization(merchantOrgId),
    schedule: ctx.platformFeeSchedule,
    coverageStart: start,
    coverageEnd: end,
  });
  if (!meetsMinimum(statement, cfg.minimum)) return { status: "below_minimum", fees: statement.fees.amount };

  const customer = await merchantCustomer(ctx, cfg, merchantOrgId);
  const created = await ctx.invoices.create({
    organizationId: cfg.orgId,
    customerId: customer.id,
    lineItems: [{ description: statementDescription(statement, period), quantity: 1, unitAmount: money(statement.fees.amount) }],
    dueAt: new Date(end.getTime() + cfg.dueDays * 86_400_000).toISOString(),
    metadata: {
      kind: FEE_STATEMENT_KIND,
      merchantOrgId,
      period,
      coverageStart: statement.coverageStart,
      coverageEnd: statement.coverageEnd,
      paymentCount: String(statement.paymentCount),
      grossVolume: statement.grossVolume.amount,
      feeBps: String(statement.schedule.bps),
      feeFixed: statement.schedule.fixed,
    },
  });
  if (!created.ok) throw created.error;
  const sent = await sendInvoice(ctx, created.value, customer.email ? { payerEmail: customer.email } : {});
  return { status: "issued", invoice: sent.invoice, payUrl: sent.payUrl, emailedTo: sent.emailedTo };
}

/** Merchant org ids that sell on this deployment (excluding the platform org). */
async function merchantOrgIds(ctx: AppContext, cfg: PlatformBillingConfig): Promise<string[]> {
  const products = await ctx.products.list((p) => !isInvoiceProduct(p));
  const ids = new Set(products.map((p) => p.organizationId));
  ids.delete(cfg.orgId);
  return [...ids].sort();
}

export interface StatementRunResult {
  period: BillingPeriod;
  results: ({ merchantOrgId: string } & ({ status: StatementOutcome["status"]; invoiceId?: string; fees?: string } | { status: "error"; error: string }))[];
}

/** Issue every merchant's statement for `period` (safe to re-run). */
export async function runStatements(
  ctx: AppContext,
  cfg: PlatformBillingConfig,
  period: BillingPeriod,
  now: Date = new Date(),
): Promise<StatementRunResult> {
  const results: StatementRunResult["results"] = [];
  for (const merchantOrgId of await merchantOrgIds(ctx, cfg)) {
    const settings = await ctx.orgSettings.get(merchantOrgId);
    if (settings.testAccount === true) continue;
    try {
      const outcome = await issueStatement(ctx, cfg, merchantOrgId, period, now);
      results.push(
        outcome.status === "below_minimum"
          ? { merchantOrgId, status: outcome.status, fees: outcome.fees }
          : { merchantOrgId, status: outcome.status, invoiceId: outcome.invoice.id },
      );
    } catch (error) {
      results.push({ merchantOrgId, status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { period, results };
}

/** A merchant's standing from their open statements. */
export async function standingFor(
  ctx: AppContext,
  cfg: PlatformBillingConfig | null,
  merchantOrgId: string,
  now: Date = new Date(),
): Promise<BillingStanding> {
  if (!cfg || merchantOrgId === cfg.orgId) return "good";
  const statements = await statementsFor(ctx, cfg, merchantOrgId);
  return billingStanding(
    statements.map((s) => ({ status: s.status, ...(s.dueAt ? { dueAt: s.dueAt } : {}) })),
    now,
    cfg.graceDays,
  );
}

/** Public-facing summary of one statement for the merchant. */
export function statementView(invoice: Invoice) {
  const token = payTokenOf(invoice);
  return {
    id: invoice.id,
    number: invoice.number,
    period: invoice.metadata.period ?? null,
    status: invoice.status,
    total: invoice.total.amount,
    currency: invoice.currency,
    paymentCount: Number(invoice.metadata.paymentCount ?? "0"),
    grossVolume: invoice.metadata.grossVolume ?? "0",
    dueAt: invoice.dueAt ?? null,
    paidAt: invoice.paidAt ?? null,
    payUrl: token ? payUrlFor(token) : null,
  };
}

/**
 * Plan-limit gate for product creation: a restricted merchant keeps selling
 * what they have but can only add products within the free plan's limit.
 */
export async function assertCanCreateProduct(ctx: AppContext, organizationId: string, now: Date = new Date()): Promise<void> {
  const cfg = loadPlatformBillingConfig();
  if ((await standingFor(ctx, cfg, organizationId, now)) !== "restricted") return;
  const active = await ctx.products.list(
    (p) => p.organizationId === organizationId && p.status === "active" && !isInvoiceProduct(p),
  );
  if (canCreateProduct("free", active.length)) return;
  const open = (await statementsFor(ctx, cfg!, organizationId)).find((s) => s.status === "open");
  const payUrl = open ? statementView(open).payUrl : null;
  throw new SettleKitError({
    code: "payment_required",
    message: `Your SettleKit fee statement is overdue, so your account is limited to ${String(HOSTED_PLAN_LIMITS.free.products)} active products. Pay it to add more${payUrl ? `: ${payUrl}` : "."}`,
    httpStatus: 402,
    details: { payUrl },
  });
}
