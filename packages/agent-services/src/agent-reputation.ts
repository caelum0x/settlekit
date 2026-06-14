export function ratingAverage(totalStars: number, ratingCount: number): number {
  return ratingCount === 0 ? 0 : totalStars / ratingCount;
}
