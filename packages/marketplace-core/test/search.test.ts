import { describe, it, expect } from "vitest";
import { createListing, publishListing } from "../src/listing.js";
import { searchListings, type ListingWithContext } from "../src/search.js";
import type { MarketplaceListing } from "@settlekit/common";

function listing(
  overrides: Partial<MarketplaceListing> & {
    title: string;
    summary: string;
    tags: string[];
  },
  createdAt: string,
): MarketplaceListing {
  const base = createListing(
    {
      organizationId: "org_1",
      merchantId: "mch_1",
      productId: "prod_1",
      title: overrides.title,
      summary: overrides.summary,
      tags: overrides.tags,
    },
    new Date(createdAt),
  );
  return publishListing({ ...base, ...overrides, createdAt });
}

describe("searchListings ranking", () => {
  const llmGuide = listing(
    {
      title: "LLM Prompt Engineering Guide",
      summary: "Master prompt design for language models",
      tags: ["ai", "prompts"],
      ratingAverage: 4.0,
      ratingCount: 10,
    },
    "2026-01-01T00:00:00.000Z",
  );
  const promptKit = listing(
    {
      title: "Prompt Kit",
      summary: "A small toolkit. Mentions prompt once.",
      tags: ["tools"],
      ratingAverage: 5.0,
      ratingCount: 2,
    },
    "2026-02-01T00:00:00.000Z",
  );
  const unrelated = listing(
    {
      title: "Cooking Recipes",
      summary: "Delicious meals",
      tags: ["food"],
      ratingAverage: 5.0,
      ratingCount: 100,
    },
    "2026-03-01T00:00:00.000Z",
  );

  const inputs: ListingWithContext[] = [
    { listing: llmGuide },
    { listing: promptKit },
    { listing: unrelated },
  ];

  it("ranks title matches above summary-only matches for a text query", () => {
    const results = searchListings(inputs, { query: "prompt" });
    expect(results.map((r) => r.id)).toEqual([promptKit.id, llmGuide.id]);
    // unrelated has no relevance and is filtered out
    expect(results.find((r) => r.id === unrelated.id)).toBeUndefined();
  });

  it("filters out listings with zero relevance to the query", () => {
    const results = searchListings(inputs, { query: "language models" });
    expect(results.map((r) => r.id)).toEqual([llmGuide.id]);
  });

  it("sort=top orders by rating average then count when no query", () => {
    const results = searchListings(inputs, { sort: "top" });
    expect(results[0]?.id).toBe(unrelated.id); // 5.0 / 100
    expect(results.map((r) => r.id)).toEqual([
      unrelated.id,
      promptKit.id,
      llmGuide.id,
    ]);
  });

  it("sort=new orders newest first", () => {
    const results = searchListings(inputs, { sort: "new" });
    expect(results.map((r) => r.id)).toEqual([
      unrelated.id,
      promptKit.id,
      llmGuide.id,
    ]);
  });

  it("sort=price orders cheapest first, missing prices last", () => {
    const priced: ListingWithContext[] = [
      { listing: llmGuide, priceBaseUnits: 3_000_000n },
      { listing: promptKit, priceBaseUnits: 1_000_000n },
      { listing: unrelated }, // no price
    ];
    const results = searchListings(priced, { sort: "price" });
    expect(results.map((r) => r.id)).toEqual([
      promptKit.id,
      llmGuide.id,
      unrelated.id,
    ]);
  });

  it("tags filter uses AND semantics and is case-insensitive", () => {
    const results = searchListings(inputs, { tags: ["AI"] });
    expect(results.map((r) => r.id)).toEqual([llmGuide.id]);
  });

  it("only returns published listings", () => {
    const draft = { ...llmGuide, published: false };
    const results = searchListings([{ listing: draft }], { sort: "top" });
    expect(results).toHaveLength(0);
  });

  it("matches against tags as a query term", () => {
    const results = searchListings(inputs, { query: "ai" });
    expect(results.map((r) => r.id)).toEqual([llmGuide.id]);
  });
});
