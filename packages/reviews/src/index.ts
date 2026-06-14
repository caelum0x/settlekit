export interface Review {
  listingId: string;
  customerId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  body: string;
  createdAt: string;
}

export function createReview(input: Omit<Review, "createdAt">, now = new Date()): Review {
  if (input.body.trim().length === 0) throw new Error("review body is required");
  return { ...input, body: input.body.trim(), createdAt: now.toISOString() };
}

export function reviewSummary(reviews: Review[]): { ratingAverage: number; ratingCount: number } {
  if (reviews.length === 0) return { ratingAverage: 0, ratingCount: 0 };
  return { ratingAverage: reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length, ratingCount: reviews.length };
}
