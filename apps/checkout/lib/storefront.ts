/**
 * Hosted storefronts: the checkout side of /store/<slug> (and custom domains).
 */
import { apiBaseUrl } from "./payment-link";

export interface StorefrontProduct {
  name: string;
  description: string;
  slug: string;
  priceUsd: string;
  displayCurrency: string | null;
  displayAmount: string | null;
  interval: string;
}

export interface Storefront {
  slug: string;
  title: string;
  tagline: string | null;
  logoUrl: string | null;
  accentColor: string | null;
  seoDescription: string | null;
  merchantName: string;
  acceptingPayments: boolean;
  networks: string[];
  products: StorefrontProduct[];
}

const SLUG_RE = /^[a-z0-9-]{3,40}$/;
const DOMAIN_RE = /^[a-z0-9.-]{3,253}$/;

/** Load a store by slug, or by custom domain when `slug` starts with "domain:". */
export async function getStorefront(key: { slug?: string; domain?: string }): Promise<Storefront | null> {
  let path: string;
  if (key.slug !== undefined) {
    if (!SLUG_RE.test(key.slug)) return null;
    path = `/v1/public/stores/${encodeURIComponent(key.slug)}`;
  } else if (key.domain !== undefined) {
    const domain = key.domain.toLowerCase();
    if (!DOMAIN_RE.test(domain)) return null;
    path = `/v1/public/stores/by-domain/${encodeURIComponent(domain)}`;
  } else {
    return null;
  }
  const res = await fetch(`${apiBaseUrl()}${path}`, { cache: "no-store" });
  if (res.status === 404) return null;
  const body = (await res.json().catch(() => null)) as { data?: Storefront } | null;
  if (!res.ok || !body?.data) throw new Error(`Store unavailable (${res.status})`);
  return body.data;
}

/** A safe accent colour for inline styles (validated #rrggbb only). */
export function accent(store: Pick<Storefront, "accentColor">): string {
  return store.accentColor && /^#[0-9a-fA-F]{6}$/.test(store.accentColor) ? store.accentColor : "#1e40a2";
}

const INTERVAL: Record<string, string> = { monthly: " / month", yearly: " / year" };

/** Price label shown on a product card. */
export function priceLabel(p: StorefrontProduct): string {
  const base = p.displayCurrency && p.displayAmount ? `${p.displayAmount} ${p.displayCurrency}` : `$${p.priceUsd}`;
  return `${base}${INTERVAL[p.interval] ?? ""}`;
}
