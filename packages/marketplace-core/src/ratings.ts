import { validationError, type MarketplaceListing } from "@settlekit/common";

export const MIN_STARS = 1;
export const MAX_STARS = 5;

/** Round to 2 decimal places to keep a stable, displayable average. */
function roundAverage(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Fold a 1..5 star rating into a listing's aggregate, returning a new listing
 * with recomputed {@link MarketplaceListing.ratingAverage} and
 * {@link MarketplaceListing.ratingCount}. The input listing is never mutated.
 *
 * The new average is computed as a running mean:
 *   avg' = (avg * count + stars) / (count + 1)
 */
export function addRating(
  listing: MarketplaceListing,
  stars: number,
): MarketplaceListing {
  if (!Number.isInteger(stars) || stars < MIN_STARS || stars > MAX_STARS) {
    throw validationError("Rating must be an integer between 1 and 5", {
      min: MIN_STARS,
      max: MAX_STARS,
      received: stars,
    });
  }

  const previousTotal = listing.ratingAverage * listing.ratingCount;
  const nextCount = listing.ratingCount + 1;
  const nextAverage = roundAverage((previousTotal + stars) / nextCount);

  return {
    ...listing,
    ratingAverage: nextAverage,
    ratingCount: nextCount,
  };
}

/**
 * Recompute a listing's aggregate from a full set of raw star ratings. Useful
 * for rebuilding state from an event log rather than incrementally.
 */
export function recomputeRatings(
  listing: MarketplaceListing,
  allStars: readonly number[],
): MarketplaceListing {
  let sum = 0;
  for (const stars of allStars) {
    if (!Number.isInteger(stars) || stars < MIN_STARS || stars > MAX_STARS) {
      throw validationError("Rating must be an integer between 1 and 5", {
        min: MIN_STARS,
        max: MAX_STARS,
        received: stars,
      });
    }
    sum += stars;
  }

  const count = allStars.length;
  const average = count === 0 ? 0 : roundAverage(sum / count);

  return {
    ...listing,
    ratingAverage: average,
    ratingCount: count,
  };
}
