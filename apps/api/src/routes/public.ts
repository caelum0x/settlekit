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

  app.get("/proof", async (c) => {
    c.header("cache-control", "public, max-age=30");
    return data(c, await buildProof(c.get("ctx")));
  });

  return app;
}
