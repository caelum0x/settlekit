/**
 * Hosted storefront: one branded page per merchant listing their active
 * products, each opening its reusable payment link. Served by the checkout
 * app at /store/<slug> (or the merchant's custom domain).
 */
import { SettleKitError, notFound, type Product } from "@settlekit/common";
import type { StoreSettings } from "@settlekit/persistence";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { isInvoiceProduct } from "./invoice-payments.js";
import { activePrice, slugOf } from "./products.js";
import { payableNetworks } from "./payment-links.js";

export const storeSchema = z.object({
  enabled: z.boolean(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "3-40 lowercase letters, digits or dashes"),
  title: z.string().trim().max(80).optional(),
  tagline: z.string().trim().max(160).optional(),
  logoUrl: z.string().trim().url().refine((v) => v.startsWith("https://"), "logo must be an https:// image").optional(),
  accentColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "use a colour like #1e40a2").optional(),
  seoDescription: z.string().trim().max(300).optional(),
  customDomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/, "a domain like shop.example.com")
    .optional(),
});

const RESERVED = new Set(["admin", "api", "settlekit", "store", "www", "checkout", "pay"]);

/** Validate a store patch (slug unique across merchants). */
export async function validateStore(ctx: AppContext, organizationId: string, input: z.infer<typeof storeSchema>): Promise<StoreSettings> {
  if (RESERVED.has(input.slug)) throw new SettleKitError({ code: "validation_error", message: "That store address is reserved" });
  const taken = await ctx.orgSettings.findByStore?.({ slug: input.slug });
  if (taken && taken.organizationId !== organizationId) {
    throw new SettleKitError({ code: "conflict", message: "That store address is taken" });
  }
  if (input.customDomain) {
    const domain = await ctx.orgSettings.findByStore?.({ domain: input.customDomain });
    if (domain && domain.organizationId !== organizationId) {
      throw new SettleKitError({ code: "conflict", message: "That domain is used by another store" });
    }
  }
  return input;
}

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
  /** Whether buyers can pay right now (the merchant finished payment setup). */
  acceptingPayments: boolean;
  networks: string[];
  products: StorefrontProduct[];
}

/** The public storefront for a slug or custom domain. */
export async function loadStorefront(ctx: AppContext, match: { slug?: string; domain?: string }): Promise<Storefront> {
  const found = await ctx.orgSettings.findByStore?.(match);
  const store = found?.settings.store;
  if (!found || !store?.enabled) throw notFound("This store does not exist");
  const products = await ctx.products.list(
    (p: Product) => p.organizationId === found.organizationId && p.status === "active" && !isInvoiceProduct(p) && slugOf(p) !== null,
  );
  const views: StorefrontProduct[] = [];
  for (const product of products.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const price = await activePrice(ctx, product.id);
    if (!price) continue;
    views.push({
      name: product.name,
      description: product.description,
      slug: slugOf(product)!,
      priceUsd: price.amount,
      displayCurrency: price.displayCurrency ?? null,
      displayAmount: price.displayAmount ?? null,
      interval: price.interval,
    });
  }
  const { merchantName, accepted } = await payableNetworks(ctx, found.organizationId);
  return {
    slug: store.slug,
    title: store.title || merchantName,
    tagline: store.tagline ?? null,
    logoUrl: store.logoUrl ?? null,
    accentColor: store.accentColor ?? null,
    seoDescription: store.seoDescription ?? null,
    merchantName,
    acceptingPayments: accepted.length > 0,
    networks: accepted,
    products: views,
  };
}
