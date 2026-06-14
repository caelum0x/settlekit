import { describe, expect, it } from "vitest";
import { createReview, reviewSummary } from "../src/index.js";

describe("reviews", () => {
  it("creates reviews and calculates summary", () => {
    const review = createReview({ listingId: "ml_1", customerId: "cus_1", rating: 5, body: " Useful " });
    expect(review.body).toBe("Useful");
    expect(reviewSummary([review]).ratingAverage).toBe(5);
  });
});
