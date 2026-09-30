/**
 * Invoice routes — real invoicing over the `@settlekit/invoices`
 * `InvoiceService` (in-memory store on the app context).
 *
 *   POST /v1/invoices                 create a draft invoice
 *   GET  /v1/invoices?customerId=      list (optionally filtered)
 *   GET  /v1/invoices/:id              fetch one
 *   GET  /v1/invoices/:id.html         render the styled HTML invoice
 *   POST /v1/invoices/:id/finalize     draft -> open
 *   POST /v1/invoices/:id/pay          open  -> paid
 *   POST /v1/invoices/:id/void         draft|open -> void
 *   POST /v1/invoices/:id/send         issue + pay link + email (payable onchain)
 *   GET  /v1/invoices/:id.pdf          invoice (or receipt, once paid) PDF
 *   POST /v1/invoices/requests         ad-hoc payment request (amount + memo), sent
 *
 * Reads reconcile an open, sent invoice against its checkout sessions, so the
 * status flips to paid as soon as a confirmed payment exists.
 */
import { Hono, type Context } from "hono";
import { z } from "zod";
import { generateId, money, validationError } from "@settlekit/common";
import { renderInvoicePdf } from "@settlekit/invoices";
import type { Invoice, InvoiceLineItem } from "@settlekit/invoices";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { unwrapResult } from "../http/internal.js";
import { requireOrg, requireOwned, scopeToOrg } from "../http/tenant.js";
import {
  closeInvoiceSessions,
  invoiceMerchant,
  payUrlFor,
  reconcileInvoiceWithPayments,
  sendInvoice,
} from "../merchant/invoice-payments.js";
import { payTokenOf } from "@settlekit/invoices";

const amount = z.string().regex(/^\d+(\.\d+)?$/);

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().int().min(1),
  unitAmount: amount,
});

const taxRateSchema = z.object({
  jurisdiction: z.string().min(1),
  rateBps: z.number().int().min(0).max(10_000),
  inclusive: z.boolean().optional(),
});

const createSchema = z.object({
  // Derived from the authenticated org (tenant scope); ignored if supplied.
  organizationId: z.string().min(1).optional(),
  customerId: z.string().min(1),
  lineItems: z.array(lineItemSchema).optional(),
  discount: amount.optional(),
  taxRate: taxRateSchema.optional(),
  dueAt: z.string().datetime().optional(),
  metadata: z.record(z.string()).optional(),
});

const sendSchema = z.object({
  payerEmail: z.string().trim().email().optional(),
});

const requestSchema = z.object({
  amount: amount.refine((v) => Number(v) > 0, "amount must be greater than zero"),
  description: z.string().trim().min(1).max(280),
  payerEmail: z.string().trim().email().optional(),
  customerId: z.string().min(1).optional(),
  dueAt: z.string().datetime().optional(),
  metadata: z.record(z.string()).optional(),
  /** Email the pay link to payerEmail (default true). Plugins that redirect set false. */
  sendEmail: z.boolean().optional(),
  /** Where the hosted checkout returns the payer after paying (https). */
  successUrl: z.string().url().refine((v) => v.startsWith("https://") || v.startsWith("http://localhost"), "successUrl must be https").optional(),
});

function toLineItem(input: z.infer<typeof lineItemSchema>): InvoiceLineItem {
  return { description: input.description, quantity: input.quantity, unitAmount: money(input.unitAmount) };
}

/** Load an invoice by id, requiring it belongs to the caller's org (else 404). */
async function ownedInvoice(c: Context<AppEnv>, id: string): Promise<Invoice> {
  const found = await c.get("ctx").invoices.get(id);
  const owned = requireOwned(c, found.ok ? found.value : undefined, "invoice", id);
  return reconcileInvoiceWithPayments(c.get("ctx"), owned);
}

/** The org customer for a payer email, created on first request. */
async function customerForEmail(c: Context<AppEnv>, email: string): Promise<string> {
  const ctx = c.get("ctx");
  const org = requireOrg(c);
  const lower = email.toLowerCase();
  const [existing] = await ctx.customers.list((cu) => cu.organizationId === org && cu.email.toLowerCase() === lower);
  if (existing) return existing.id;
  const customer = await ctx.customers.save({
    id: generateId("customer"),
    organizationId: org,
    email,
    metadata: { source: "payment_request" },
    createdAt: new Date().toISOString(),
  });
  return customer.id;
}

export function invoiceRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const body = await parseBody(c, createSchema);
    const invoice = unwrapResult(
      await c.get("ctx").invoices.create({
        organizationId: requireOrg(c),
        customerId: body.customerId,
        ...(body.lineItems !== undefined ? { lineItems: body.lineItems.map(toLineItem) } : {}),
        ...(body.discount !== undefined ? { discount: money(body.discount) } : {}),
        ...(body.taxRate !== undefined
          ? {
              taxRate: {
                jurisdiction: body.taxRate.jurisdiction,
                rateBps: body.taxRate.rateBps,
                inclusive: body.taxRate.inclusive ?? false,
              },
            }
          : {}),
        ...(body.dueAt !== undefined ? { dueAt: body.dueAt } : {}),
        ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
      }),
    );
    return created(c, invoice);
  });

  // Ad-hoc payment request: one line, sent immediately. Registered before
  // `/:id` routes so "requests" is never read as an invoice id.
  app.post("/requests", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, requestSchema);
    if (!body.customerId && !body.payerEmail) {
      throw validationError("payerEmail or customerId is required", { fields: ["payerEmail", "customerId"] });
    }
    if (body.customerId) {
      const customer = await ctx.customers.findById(body.customerId);
      requireOwned(c, customer, "customer", body.customerId);
    }
    const customerId = body.customerId ?? (await customerForEmail(c, body.payerEmail!));
    const invoice = unwrapResult(
      await ctx.invoices.create({
        organizationId: requireOrg(c),
        customerId,
        lineItems: [{ description: body.description, quantity: 1, unitAmount: money(body.amount) }],
        ...(body.dueAt !== undefined ? { dueAt: body.dueAt } : {}),
        metadata: {
          ...(body.metadata ?? {}),
          kind: "payment_request",
          ...(body.successUrl ? { successUrl: body.successUrl } : {}),
        },
      }),
    );
    const sent = await sendInvoice(ctx, invoice, {
      ...(body.payerEmail ? { payerEmail: body.payerEmail } : {}),
      ...(body.sendEmail === false ? { skipEmail: true } : {}),
    });
    return created(c, sent);
  });

  app.get("/", async (c) => {
    const ctx = c.get("ctx");
    const customerId = c.req.query("customerId");
    const invoices = scopeToOrg(c, await ctx.invoices.list(customerId ?? undefined));
    return data(c, await Promise.all(invoices.map((inv) => reconcileInvoiceWithPayments(ctx, inv))));
  });

  app.get("/:id{.+\\.pdf}", async (c) => {
    const ctx = c.get("ctx");
    const invoice = await ownedInvoice(c, c.req.param("id").replace(/\.pdf$/, ""));
    const token = payTokenOf(invoice);
    const pdf = await renderInvoicePdf(invoice, await invoiceMerchant(ctx, invoice.organizationId), token ? { payUrl: payUrlFor(token) } : {});
    return c.body(new Uint8Array(pdf), 200, {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${invoice.number}.pdf"`,
    });
  });

  // `:id.html` must be matched before the bare `:id` route below.
  app.get("/:id{.+\\.html}", async (c) => {
    const { id } = await ownedInvoice(c, c.req.param("id").replace(/\.html$/, ""));
    const html = unwrapResult(await c.get("ctx").invoices.renderHtml(id, c.get("ctx").merchant));
    return c.html(html);
  });

  app.get("/:id", async (c) => {
    return data(c, await ownedInvoice(c, c.req.param("id")));
  });

  app.post("/:id/finalize", async (c) => {
    const { id } = await ownedInvoice(c, c.req.param("id"));
    const invoice = unwrapResult(await c.get("ctx").invoices.finalize(id));
    return data(c, invoice);
  });

  app.post("/:id/pay", async (c) => {
    const { id } = await ownedInvoice(c, c.req.param("id"));
    const invoice = unwrapResult(await c.get("ctx").invoices.markPaid(id));
    return data(c, invoice);
  });

  app.post("/:id/send", async (c) => {
    const invoice = await ownedInvoice(c, c.req.param("id"));
    const raw = await c.req.json().catch(() => ({}));
    const body = sendSchema.safeParse(raw);
    if (!body.success) throw validationError("payerEmail must be an email address", { fields: ["payerEmail"] });
    const sent = await sendInvoice(c.get("ctx"), invoice, body.data.payerEmail ? { payerEmail: body.data.payerEmail } : {});
    return data(c, sent);
  });

  app.post("/:id/void", async (c) => {
    const ctx = c.get("ctx");
    const { id } = await ownedInvoice(c, c.req.param("id"));
    const invoice = unwrapResult(await ctx.invoices.void(id));
    await closeInvoiceSessions(ctx, invoice);
    return data(c, invoice);
  });

  return app;
}
