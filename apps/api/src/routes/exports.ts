/**
 * Merchant accounting exports (CSV), tenant-scoped.
 *
 *   GET /v1/exports/payments.csv            confirmed + refunded payments
 *   GET /v1/exports/refunds.csv             refunds
 *   GET /v1/exports/invoices.csv            invoices and payment requests
 *   GET /v1/exports/payouts.csv             payouts
 *   GET /v1/exports/ledger.csv              every wallet movement, all fields
 *   GET /v1/exports/xero.csv                Xero bank statement import
 *   GET /v1/exports/quickbooks.csv          QuickBooks Online bank upload
 *
 * Optional `?from=YYYY-MM-DD&to=YYYY-MM-DD` (to is exclusive). Every text
 * cell is guarded against spreadsheet formula injection.
 */
import { Hono, type Context } from "hono";
import { validationError, type Payment } from "@settlekit/common";
import {
  inRange,
  ledgerCsv,
  quickBooksStatementCsv,
  toCsv,
  xeroStatementCsv,
  type LedgerEntry,
} from "@settlekit/exports";
import type { AppContext, AppEnv } from "../context.js";
import { ownedPaymentIds, requireOrg, scopeToOrg } from "../http/tenant.js";
import { reconcileInvoiceWithPayments } from "../merchant/invoice-payments.js";

const GUARD = { guardFormulas: true } as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function range(c: Context<AppEnv>): { from?: Date; to?: Date } {
  const parse = (key: "from" | "to"): Date | undefined => {
    const raw = c.req.query(key);
    if (raw === undefined || raw === "") return undefined;
    if (!DATE_RE.test(raw) || Number.isNaN(new Date(`${raw}T00:00:00Z`).getTime())) {
      throw validationError(`${key} must be a date like 2026-09-01`, { fields: [key] });
    }
    return new Date(`${raw}T00:00:00Z`);
  };
  const from = parse("from");
  const to = parse("to");
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

function within(iso: string | undefined, r: { from?: Date; to?: Date }): boolean {
  if (!iso) return r.from === undefined && r.to === undefined;
  const t = new Date(iso).getTime();
  return (r.from === undefined || t >= r.from.getTime()) && (r.to === undefined || t < r.to.getTime());
}

function csv(c: Context<AppEnv>, name: string, body: string): Response {
  const org = requireOrg(c).replace(/[^A-Za-z0-9_-]/g, "");
  return c.body(body, 200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="settlekit-${org}-${name}.csv"`,
    "cache-control": "private, no-store",
  });
}

/** Buyer label for a payment: customer email when known, else the id. */
async function payeeFor(ctx: AppContext, customerId: string, cache: Map<string, string>): Promise<string> {
  const known = cache.get(customerId);
  if (known !== undefined) return known;
  const customer = await ctx.customers.findById(customerId);
  const label = customer?.email || customerId;
  cache.set(customerId, label);
  return label;
}

async function productNames(ctx: AppContext, payment: Payment): Promise<string> {
  const session = await ctx.checkouts.findById(payment.checkoutSessionId);
  if (!session) return "Payment";
  const names = await Promise.all(
    session.lineItems.map(async (l) => (l.productId ? (await ctx.products.findById(l.productId))?.name : undefined)),
  );
  return names.filter(Boolean).join(", ") || "Payment";
}

/** Every USDC movement of the org: payments in, refunds out. */
async function ledger(c: Context<AppEnv>): Promise<LedgerEntry[]> {
  const ctx = c.get("ctx");
  const org = requireOrg(c);
  const payments = (await ctx.payments.listByOrganization(org)).filter(
    (p) => p.status === "confirmed" || p.status === "refunded",
  );
  const cache = new Map<string, string>();
  const byId = new Map(payments.map((p) => [p.id, p]));
  const entries: LedgerEntry[] = [];
  for (const p of payments) {
    entries.push({
      date: p.confirmedAt ?? p.createdAt,
      amount: p.amount.amount,
      currency: p.amount.currency,
      payee: await payeeFor(ctx, p.customerId, cache),
      description: await productNames(ctx, p),
      reference: p.id,
      network: p.network,
      txHash: p.txHash ?? "",
      kind: "payment",
    });
  }
  const refunds = (await ctx.refundStore.listAll()).filter((r) => byId.has(r.paymentId) && r.status === "succeeded");
  for (const r of refunds) {
    const payment = byId.get(r.paymentId)!;
    entries.push({
      date: r.updatedAt,
      amount: `-${r.amount.amount}`,
      currency: r.amount.currency,
      payee: await payeeFor(ctx, r.customerId, cache),
      description: `Refund (${r.reason})`,
      reference: r.id,
      network: payment.network,
      txHash: r.txHash ?? "",
      kind: "refund",
    });
  }
  return entries;
}

export function exportRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/payments.csv", async (c) => {
    const ctx = c.get("ctx");
    const r = range(c);
    const cache = new Map<string, string>();
    const payments = (await ctx.payments.listByOrganization(requireOrg(c)))
      .filter((p) => within(p.confirmedAt ?? p.createdAt, r))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const rows = await Promise.all(
      payments.map(async (p) => ({ p, payee: await payeeFor(ctx, p.customerId, cache), items: await productNames(ctx, p) })),
    );
    return csv(
      c,
      "payments",
      toCsv(
        rows,
        [
          { header: "id", value: (x) => x.p.id },
          { header: "created_at", value: (x) => x.p.createdAt },
          { header: "confirmed_at", value: (x) => x.p.confirmedAt ?? "" },
          { header: "status", value: (x) => x.p.status },
          { header: "amount", value: (x) => x.p.amount.amount },
          { header: "currency", value: (x) => x.p.amount.currency },
          { header: "network", value: (x) => x.p.network },
          { header: "tx_hash", value: (x) => x.p.txHash ?? "" },
          { header: "customer", value: (x) => x.payee },
          { header: "items", value: (x) => x.items },
          { header: "checkout_session_id", value: (x) => x.p.checkoutSessionId },
        ],
        GUARD,
      ),
    );
  });

  app.get("/refunds.csv", async (c) => {
    const ctx = c.get("ctx");
    const r = range(c);
    const owned = await ownedPaymentIds(c);
    const refunds = (await ctx.refundStore.listAll())
      .filter((x) => owned.has(x.paymentId) && within(x.createdAt, r))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return csv(
      c,
      "refunds",
      toCsv(
        refunds,
        [
          { header: "id", value: (x) => x.id },
          { header: "payment_id", value: (x) => x.paymentId },
          { header: "created_at", value: (x) => x.createdAt },
          { header: "status", value: (x) => x.status },
          { header: "amount", value: (x) => x.amount.amount },
          { header: "currency", value: (x) => x.amount.currency },
          { header: "reason", value: (x) => x.reason },
          { header: "tx_hash", value: (x) => x.txHash ?? "" },
        ],
        GUARD,
      ),
    );
  });

  app.get("/invoices.csv", async (c) => {
    const ctx = c.get("ctx");
    const r = range(c);
    const invoices = await Promise.all(
      scopeToOrg(c, await ctx.invoices.list())
        .filter((i) => within(i.issuedAt ?? i.paidAt ?? i.dueAt, r))
        .map((i) => reconcileInvoiceWithPayments(ctx, i)),
    );
    const cache = new Map<string, string>();
    const rows = await Promise.all(invoices.map(async (i) => ({ i, payee: await payeeFor(ctx, i.customerId, cache) })));
    return csv(
      c,
      "invoices",
      toCsv(
        rows.sort((a, b) => a.i.number.localeCompare(b.i.number)),
        [
          { header: "number", value: (x) => x.i.number },
          { header: "id", value: (x) => x.i.id },
          { header: "kind", value: (x) => x.i.metadata.kind ?? "invoice" },
          { header: "status", value: (x) => x.i.status },
          { header: "customer", value: (x) => x.payee },
          { header: "issued_at", value: (x) => x.i.issuedAt ?? "" },
          { header: "due_at", value: (x) => x.i.dueAt ?? "" },
          { header: "paid_at", value: (x) => x.i.paidAt ?? "" },
          { header: "subtotal", value: (x) => x.i.subtotal.amount },
          { header: "discount", value: (x) => x.i.discount?.amount ?? "0" },
          { header: "tax", value: (x) => x.i.tax?.amount ?? "0" },
          { header: "total", value: (x) => x.i.total.amount },
          { header: "currency", value: (x) => x.i.currency },
          { header: "paid_tx_hash", value: (x) => x.i.metadata.paidTxHash ?? "" },
        ],
        GUARD,
      ),
    );
  });

  app.get("/payouts.csv", async (c) => {
    const ctx = c.get("ctx");
    const r = range(c);
    const payouts = (await ctx.payoutStore.listByOrganization(requireOrg(c)))
      .filter((p) => within(p.createdAt, r))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return csv(
      c,
      "payouts",
      toCsv(
        payouts,
        [
          { header: "id", value: (x) => x.id },
          { header: "created_at", value: (x) => x.createdAt },
          { header: "status", value: (x) => x.status },
          { header: "amount", value: (x) => x.amount.amount },
          { header: "currency", value: (x) => x.amount.currency },
          { header: "network", value: (x) => x.network },
          { header: "wallet", value: (x) => x.walletAddress },
          { header: "tx_hash", value: (x) => x.txHash ?? "" },
        ],
        GUARD,
      ),
    );
  });

  app.get("/ledger.csv", async (c) => {
    const r = range(c);
    return csv(c, "ledger", ledgerCsv(inRange(await ledger(c), r.from, r.to)));
  });

  app.get("/xero.csv", async (c) => {
    const r = range(c);
    return csv(c, "xero-bank-statement", xeroStatementCsv(inRange(await ledger(c), r.from, r.to)));
  });

  app.get("/quickbooks.csv", async (c) => {
    const r = range(c);
    return csv(c, "quickbooks-bank-upload", quickBooksStatementCsv(inRange(await ledger(c), r.from, r.to)));
  });

  return app;
}
