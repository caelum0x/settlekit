import { describe, it, expect } from "vitest";
import { createListing } from "../src/listing.js";
import { addRating, recomputeRatings } from "../src/ratings.js";
import type { MarketplaceListing } from "@settlekit/common";

function freshListing(): MarketplaceListing {
  return createListing({
    organizationId: "org_1",
    merchantId: "mch_1",
    productId: "prod_1",
    title: "Test Listing",
    summary: "A listing",
    tags: [],
  });
}

describe("addRating", () => {
  it("sets the average to the first rating", () => {
    const updated = addRating(freshListing(), 4);
    expect(updated.ratingCount).toBe(1);
    expect(updated.ratingAverage).toBe(4);
  });

  it("recomputes a running mean across multiple ratings", () => {
    let listing = freshListing();
    listing = addRating(listing, 5);
    listing = addRating(listing, 3);
    listing = addRating(listing, 4);
    expect(listing.ratingCount).toBe(3);
    expect(listing.ratingAverage).toBe(4); // (5+3+4)/3
  });

  it("rounds the average to 2 decimal places", () => {
    let listing = freshListing();
    listing = addRating(listing, 5);
    listing = addRating(listing, 4); // (5+4)/2 = 4.5
    listing = addRating(listing, 4); // 13/3 = 4.333...
    expect(listing.ratingAverage).toBe(4.33);
  });

  it("does not mutate the input listing", () => {
    const original = freshListing();
    const updated = addRating(original, 5);
    expect(original.ratingCount).toBe(0);
    expect(original.ratingAverage).toBe(0);
    expect(updated).not.toBe(original);
  });

  it("rejects out-of-range and non-integer stars", () => {
    const listing = freshListing();
    expect(() => addRating(listing, 0)).toThrow();
    expect(() => addRating(listing, 6)).toThrow();
    expect(() => addRating(listing, 3.5)).toThrow();
  });
});

describe("recomputeRatings", () => {
  it("rebuilds the aggregate from a full set of ratings", () => {
    const result = recomputeRatings(freshListing(), [5, 5, 4, 2]);
    expect(result.ratingCount).toBe(4);
    expect(result.ratingAverage).toBe(4); // 16/4
  });

  it("returns a zeroed aggregate for an empty set", () => {
    const result = recomputeRatings(freshListing(), []);
    expect(result.ratingCount).toBe(0);
    expect(result.ratingAverage).toBe(0);
  });
});
