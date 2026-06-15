/**
 * Helpers for reading Next.js App Router `searchParams`, where a key may be a
 * string, a string[] (repeated param), or undefined.
 */

export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Read a single string value from a possibly-repeated search param. */
export function readString(
  params: RawSearchParams,
  key: string,
): string | undefined {
  const value = params[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Read a list of values, accepting both repeated params and comma lists. */
export function readList(params: RawSearchParams, key: string): string[] {
  const value = params[key];
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  const out: string[] = [];
  for (const entry of raw) {
    for (const piece of entry.split(",")) {
      const trimmed = piece.trim();
      if (trimmed.length > 0 && !out.includes(trimmed)) out.push(trimmed);
    }
  }
  return out;
}

/** Read a sort value constrained to the allowed listing sorts. */
export function readSort(
  params: RawSearchParams,
): "top" | "new" | "price" {
  const value = readString(params, "sort");
  if (value === "new" || value === "price") return value;
  return "top";
}

/** Read a network value constrained to the supported settlement networks. */
export function readNetwork(
  params: RawSearchParams,
): "arc" | "base" | undefined {
  const value = readString(params, "network");
  if (value === "arc" || value === "base") return value;
  return undefined;
}
