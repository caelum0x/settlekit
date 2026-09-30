/**
 * Public (unauthenticated) routes: buyers and visitors, no API key.
 *
 *   GET  /v1/public/networks              networks this deployment runs
 *   GET  /v1/public/links/:slug           payment-link summary (product, price, networks)
 *   POST /v1/public/links/:slug/sessions  open a fresh checkout session for one visit
 *   GET  /v1/public/proof                 recent confirmed payments + totals per network
 *
 * Only non-sensitive data leaves these routes: no buyer identity, no seller
 * account data beyond the display name on their own payment link.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { validate } from "../http/validate.js";
import { networkCatalog } from "../merchant/network-catalog.js";
import { linkSummary, openLinkSession } from "../merchant/payment-links.js";
import { buildProof } from "../merchant/proof.js";
import {
  invoiceByToken,
  invoiceMerchant,
  openInvoiceSession,
  payUrlFor,
  publicInvoiceView,
} from "../merchant/invoice-payments.js";
import { renderInvoicePdf } from "@settlekit/invoices";

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/, "invalid invoice link");
const slugSchema = z.string().regex(/^[a-z0-9-]{4,64}$/, "invalid payment link");

const sessionSchema = z.object({
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

export function publicRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/networks", (c) => data(c, networkCatalog()));

  app.get("/links/:slug", async (c) => {
    const slug = validate(slugSchema, c.req.param("slug"));
    return data(c, await linkSummary(c.get("ctx"), slug));
  });

  app.post("/links/:slug/sessions", async (c) => {
    const slug = validate(slugSchema, c.req.param("slug"));
    const raw = await c.req.json().catch(() => ({}));
    const body = validate(sessionSchema, raw);
    const session = await openLinkSession(c.get("ctx"), slug, body);
    return created(c, { sessionId: session.id, expiresAt: session.expiresAt });
  });

  // Invoices + payment requests: the pay token IS the capability (unguessable,
  // 24 random bytes); an unknown token answers 404, a malformed one 400.
  app.get("/invoices/:token", async (c) => {
    const token = validate(tokenSchema, c.req.param("token"));
    const ctx = c.get("ctx");
    return data(c, await publicInvoiceView(ctx, await invoiceByToken(ctx, token)));
  });

  app.post("/invoices/:token/sessions", async (c) => {
    const token = validate(tokenSchema, c.req.param("token"));
    const ctx = c.get("ctx");
    const { session } = await openInvoiceSession(ctx, await invoiceByToken(ctx, token));
    return created(c, { sessionId: session.id, expiresAt: session.expiresAt });
  });

  app.get("/invoices/:token/pdf", async (c) => {
    const token = validate(tokenSchema, c.req.param("token"));
    const ctx = c.get("ctx");
    const invoice = await invoiceByToken(ctx, token);
    const pdf = await renderInvoicePdf(invoice, await invoiceMerchant(ctx, invoice.organizationId), {
      payUrl: payUrlFor(token),
    });
    return c.body(new Uint8Array(pdf), 200, {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${invoice.number}.pdf"`,
      "cache-control": "private, no-store",
    });
  });

  app.get("/proof", async (c) => {
    c.header("cache-control", "public, max-age=30");
    return data(c, await buildProof(c.get("ctx")));
  });

  return app;
}
