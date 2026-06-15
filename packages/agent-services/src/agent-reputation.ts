/**
 * Reputation aggregation for agent service listings.
 *
 * Ratings are 1..5 stars. We keep a running aggregate so the marketplace can
 * sort/filter without re-scanning every individual review.
 */
export interface AgentReputation {
  serviceId: string;
  ratingCount: number;
  /** Sum of all star ratings; `ratingAverage` derives the mean from this. */
  ratingTotal: number;
  /** Mean rating, 0 when there are no ratings yet. */
  ratingAverage: number;
}

const MIN_STARS = 1;
const MAX_STARS = 5;

/** An empty reputation aggregate for a service. */
export function emptyAgentReputation(serviceId: string): AgentReputation {
  return { serviceId, ratingCount: 0, ratingTotal: 0, ratingAverage: 0 };
}

/** Compute the mean rating from a total and a count (0 when count is 0). */
export function ratingAverage(totalStars: number, ratingCount: number): number {
  return ratingCount === 0 ? 0 : totalStars / ratingCount;
}

/**
 * Fold a new star rating into an existing aggregate, returning a new aggregate.
 * Immutable: the input is never mutated.
 */
export function addRating(reputation: AgentReputation, stars: number): AgentReputation {
  if (!Number.isInteger(stars) || stars < MIN_STARS || stars > MAX_STARS) {
    throw new RangeError(`stars must be an integer in [${MIN_STARS}, ${MAX_STARS}], got ${stars}`);
  }
  const ratingCount = reputation.ratingCount + 1;
  const ratingTotal = reputation.ratingTotal + stars;
  return {
    serviceId: reputation.serviceId,
    ratingCount,
    ratingTotal,
    ratingAverage: ratingAverage(ratingTotal, ratingCount),
  };
}

/** Aggregate a batch of star ratings for a service into a single reputation. */
export function aggregateAgentReputation(
  serviceId: string,
  ratings: readonly number[],
): AgentReputation {
  return ratings.reduce<AgentReputation>(
    (acc, stars) => addRating(acc, stars),
    emptyAgentReputation(serviceId),
  );
}
