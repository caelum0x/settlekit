import { formatRating, ratingStars, pluralize } from "@/lib/format";

interface RatingProps {
  average: number;
  count: number;
}

/** Star rating with average and review count. */
export function Rating({ average, count }: RatingProps) {
  if (count === 0) {
    return <span className="rating count">No ratings yet</span>;
  }
  return (
    <span className="rating" aria-label={`Rated ${formatRating(average)} of 5`}>
      <span aria-hidden>{ratingStars(average)}</span>
      <span>{formatRating(average)}</span>
      <span className="count">({pluralize(count, "rating")})</span>
    </span>
  );
}
