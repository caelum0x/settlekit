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
 */
import { Hono, type Context } from "hono";
import { z } from "zod";
import { money } from "@settlekit/common";
import type { Invoice, InvoiceLineItem } from "@settlekit/invoices";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { unwrapResult } from "../http/internal.js";
import { requireOrg, requireOwned } from "../http/tenant.js";

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

function toLineItem(input: z.infer<typeof lineItemSchema>): InvoiceLineItem {
  return { description: input.description, quantity: input.quantity, unitAmount: money(input.unitAmount) };
}

/** Load an invoice by id, requiring it belongs to the caller's org (else 404). */
async function ownedInvoice(c: Context<AppEnv>, id: string): Promise<Invoice> {
  const found = await c.get("ctx").invoices.get(id);
  return requireOwned(c, found.ok ? found.value : undefined, "invoice", id);
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

  app.get("/", async (c) => {
    const customerId = c.req.query("customerId");
    const invoices = await c.get("ctx").invoices.list(customerId ?? undefined);
    return data(c, invoices);
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

  app.post("/:id/void", async (c) => {
    const { id } = await ownedInvoice(c, c.req.param("id"));
    const invoice = unwrapResult(await c.get("ctx").invoices.void(id));
    return data(c, invoice);
  });

  return app;
}
