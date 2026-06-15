/**
 * Display formatting helpers for the marketplace UI. All monetary values are
 * USDC major-unit decimal strings (never floats); these helpers only format
 * for display and never participate in monetary arithmetic.
 */

/** Format a USDC major-unit string as e.g. "$49.00" or "Free". */
export function formatPrice(amount: string): string {
  const trimmed = amount.trim();
  const value = Number.parseFloat(trimmed);
  if (Number.isNaN(value) || value === 0) {
    return "Free";
  }
  return `$${value.toFixed(2)}`;
}

/** Format a per-call agent price, e.g. "$0.05 / call". */
export function formatPerCall(amount: string): string {
  const value = Number.parseFloat(amount.trim());
  if (Number.isNaN(value)) return amount;
  // Show up to 6 significant decimals, trimming trailing zeros past 2dp.
  const fixed = value.toFixed(6).replace(/(\.\d{2}\d*?)0+$/, "$1");
  return `$${fixed} / call`;
}

/** Format a rating average to one decimal place, e.g. "4.6". */
export function formatRating(average: number): string {
  return average.toFixed(1);
}

/** Build a star string like "★★★★☆" for a 0..5 average. */
export function ratingStars(average: number): string {
  const full = Math.round(average);
  const clamped = Math.max(0, Math.min(5, full));
  return "★".repeat(clamped) + "☆".repeat(5 - clamped);
}

/** Human-friendly date, e.g. "Jan 10, 2026". */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Pluralize a count, e.g. pluralize(1, "rating") -> "1 rating". */
export function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Capitalize a network label for display, e.g. "base" -> "Base". */
export function networkLabel(network: string): string {
  return network.charAt(0).toUpperCase() + network.slice(1);
}
