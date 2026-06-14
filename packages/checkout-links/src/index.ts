import { URL } from "node:url";
import { generateId } from "@settlekit/common";

export interface CheckoutLink {
  id: string;
  merchantId: string;
  productId?: string;
  bundleId?: string;
  slug: string;
  url: string;
  active: boolean;
  createdAt: string;
}

export function createCheckoutLink(input: {
  merchantId: string;
  baseUrl: string;
  slug: string;
  productId?: string;
  bundleId?: string;
}, now = new Date()): CheckoutLink {
  if (!input.productId && !input.bundleId) throw new Error("checkout link requires productId or bundleId");
  const url = new URL(`/checkout/${input.slug}`, input.baseUrl).toString();
  return { id: generateId("checkoutSession"), merchantId: input.merchantId, productId: input.productId, bundleId: input.bundleId, slug: input.slug, url, active: true, createdAt: now.toISOString() };
}

export function deactivateCheckoutLink(link: CheckoutLink): CheckoutLink {
  return { ...link, active: false };
}
