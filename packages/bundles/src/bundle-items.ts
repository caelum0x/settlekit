import type { BundleItem } from "./types.js";

export function uniqueBundleProductIds(items: BundleItem[]): string[] {
  return [...new Set(items.map((item) => item.product.id))];
}
