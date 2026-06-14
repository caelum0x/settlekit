export function usageWithinLimit(limit: number | undefined, currentValue: number, increment = 1): boolean {
  if (limit === undefined) return true;
  return currentValue + increment <= limit;
}
