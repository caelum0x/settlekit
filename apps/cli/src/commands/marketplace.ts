/**
 * `settlekit marketplace` — publish products to the public marketplace.
 *
 *   list                 GET  /v1/marketplace/listings
 *   publish              POST /v1/marketplace/listings  (+ /:id/publish)
 *   rate <id>            POST /v1/marketplace/listings/:id/rate
 */
import type { Command } from "commander";
import { buildContext } from "../context.js";

interface Listing extends Record<string, unknown> {
  id: string;
  title: string;
  published: boolean;
  ratingAverage: number;
  ratingCount: number;
}

/** Split comma-separated tags. */
function tags(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function registerMarketplace(program: Command): void {
  const marketplace = program.command("marketplace").description("Publish + discover marketplace listings");

  marketplace
    .command("list")
    .description("Search published listings")
    .option("--query <q>", "Free-text query")
    .option("--tag <tag>", "Filter by tag")
    .option("--sort <sort>", "top | new | price", "top")
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const rows = await ctx.client.get<Listing[]>("/v1/marketplace/listings", {
        q: opts.query,
        tag: opts.tag,
        sort: opts.sort,
      });
      ctx.printList(rows, [
        { header: "ID", value: (l) => l.id },
        { header: "TITLE", value: (l) => l.title },
        { header: "RATING", value: (l) => (l.ratingCount > 0 ? `${l.ratingAverage} (${l.ratingCount})` : "-") },
      ]);
    });

  marketplace
    .command("publish")
    .description("Create a listing for a product and publish it")
    .requiredOption("--organization-id <id>", "Organization id")
    .requiredOption("--merchant-id <id>", "Merchant id")
    .requiredOption("--product-id <id>", "Product id")
    .requiredOption("--title <title>", "Listing title")
    .requiredOption("--summary <text>", "Listing summary")
    .option("--tags <list>", "Comma-separated tags", tags, [])
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const listing = await ctx.client.post<Listing>("/v1/marketplace/listings", {
        organizationId: opts.organizationId,
        merchantId: opts.merchantId,
        productId: opts.productId,
        title: opts.title,
        summary: opts.summary,
        tags: opts.tags,
      });
      const published = await ctx.client.post<Listing>(
        `/v1/marketplace/listings/${encodeURIComponent(listing.id)}/publish`,
      );
      ctx.printRecord(published);
    });

  marketplace
    .command("rate <id>")
    .description("Add a 1-5 star rating to a listing")
    .requiredOption("--stars <n>", "Stars (1-5)", (v) => Number.parseInt(v, 10))
    .action(async function (this: Command, id: string) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const listing = await ctx.client.post<Listing>(
        `/v1/marketplace/listings/${encodeURIComponent(id)}/rate`,
        { stars: opts.stars },
      );
      ctx.printRecord(listing);
    });
}
