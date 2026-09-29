/**
 * Marketplace routes (plan §11, §30) — public product listings + discovery,
 * backed by the REAL `@settlekit/marketplace-core` `MarketplaceService` over the
 * shared (Postgres or in-memory) listing store.
 *
 *   POST /v1/marketplace/listings               create an (unpublished) listing
 *   GET  /v1/marketplace/listings               search published listings
 *   GET  /v1/marketplace/listings/:id           fetch one listing
 *   POST /v1/marketplace/listings/:id/publish   publish (make discoverable)
 *   POST /v1/marketplace/listings/:id/unpublish remove from discovery
 *   POST /v1/marketplace/listings/:id/rate      add a 1–5 star rating
 *   GET  /v1/marketplace/sellers/:merchantId    aggregate seller profile
 */
import { Hono, type Context } from "hono";
import { z } from "zod";
import { notFound, type MarketplaceListing } from "@settlekit/common";
import type { ListingSort } from "@settlekit/marketplace-core";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { isOwned, requireOrg, requireOwned } from "../http/tenant.js";

const createSchema = z.object({
  // Derived from the authenticated org (tenant scope); ignored if supplied.
  organizationId: z.string().min(1).optional(),
  merchantId: z.string().min(1),
  productId: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
});

const rateSchema = z.object({
  stars: z.number().int().min(1).max(5),
});

const SORTS: ReadonlyArray<ListingSort> = ["top", "new", "price"];

/** Load a listing the caller may manage (its own org), else 404. */
async function ownedListing(c: Context<AppEnv>, id: string): Promise<MarketplaceListing> {
  return requireOwned(c, await c.get("ctx").marketplace.getListing(id), "marketplace listing", id);
}

/**
 * Load a listing the caller may SEE: published listings are public discovery
 * (any tenant), drafts only to their owner. Hidden listings answer 404.
 */
async function visibleListing(c: Context<AppEnv>, id: string): Promise<MarketplaceListing> {
  const listing = await c.get("ctx").marketplace.getListing(id);
  if (!listing || (!listing.published && !isOwned(c, listing))) {
    throw notFound("marketplace listing not found", { id });
  }
  return listing;
}

export function marketplaceRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Create a new (unpublished) listing for a product.
  app.post("/listings", async (c) => {
    const body = await parseBody(c, createSchema);
    const listing = await c.get("ctx").marketplace.createListing({
      organizationId: requireOrg(c),
      merchantId: body.merchantId,
      productId: body.productId,
      title: body.title,
      summary: body.summary,
      tags: body.tags,
    });
    return created(c, listing);
  });

  // Search published listings (q / tag / sort query params).
  app.get("/listings", async (c) => {
    const q = c.req.query("q");
    const tag = c.req.query("tag");
    const sortParam = c.req.query("sort");
    const sort = SORTS.includes(sortParam as ListingSort) ? (sortParam as ListingSort) : undefined;
    const results = await c.get("ctx").marketplace.search({
      ...(q ? { query: q } : {}),
      ...(tag ? { tags: [tag] } : {}),
      ...(sort ? { sort } : {}),
    });
    return data(c, results);
  });

  app.get("/listings/:id", async (c) => {
    return data(c, await visibleListing(c, c.req.param("id")));
  });

  app.post("/listings/:id/publish", async (c) => {
    const { id } = await ownedListing(c, c.req.param("id"));
    const listing = await c.get("ctx").marketplace.publish(id);
    return data(c, listing);
  });

  app.post("/listings/:id/unpublish", async (c) => {
    const { id } = await ownedListing(c, c.req.param("id"));
    const listing = await c.get("ctx").marketplace.unpublish(id);
    return data(c, listing);
  });

  app.post("/listings/:id/rate", async (c) => {
    const { id } = await visibleListing(c, c.req.param("id"));
    const body = await parseBody(c, rateSchema);
    const listing = await c.get("ctx").marketplace.addRating(id, body.stars);
    return data(c, listing);
  });

  app.get("/sellers/:merchantId", async (c) => {
    const profile = await c.get("ctx").marketplace.sellerProfile(c.req.param("merchantId"));
    return data(c, profile);
  });

  return app;
}
