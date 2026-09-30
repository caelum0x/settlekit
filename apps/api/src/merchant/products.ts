/**
 * One-step product setup for merchants: name, USD price and how the buyer
 * gets access, published immediately with a reusable payment link.
 *
 * Delivery kinds map onto the catalog's product types + delivery modes the
 * checkout already fulfils:
 *   github_repo  -> github_repo_access / github_invite   (metadata.repoId "owner/repo")
 *   license_key  -> license_key / license_key
 *   file         -> digital_download / file_download    (metadata.fileUrl, revealed after payment)
 *   discord_role -> discord_access / discord_role       (metadata.guildId + roleId)
 *   access       -> saas_plan / saas_entitlement        (metadata.accessUrl, optional)
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  FIAT_CURRENCIES,
  fiatToUsdc,
  generateId,
  type FiatCurrency,
  validationError,
  type DeliveryMode,
  type PaymentNetwork,
  type Price,
  type Product,
  type ProductType,
} from "@settlekit/common";
import { createProductDraft } from "@settlekit/product-catalog";
import type { AppContext } from "../context.js";
import { MERCHANT_NETWORKS } from "./network-catalog.js";

export const DELIVERY_KINDS = ["github_repo", "license_key", "file", "discord_role", "access"] as const;
export type DeliveryKind = (typeof DELIVERY_KINDS)[number];

const KIND_MAP: Record<DeliveryKind, { type: ProductType; deliveryMode: DeliveryMode }> = {
  github_repo: { type: "github_repo_access", deliveryMode: "github_invite" },
  license_key: { type: "license_key", deliveryMode: "license_key" },
  file: { type: "digital_download", deliveryMode: "file_download" },
  discord_role: { type: "discord_access", deliveryMode: "discord_role" },
  access: { type: "saas_plan", deliveryMode: "saas_entitlement" },
};

const usd = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "price must be a USD amount like 29 or 29.99")
  .refine((v) => Number(v) >= 0.5, "minimum price is $0.50")
  .refine((v) => Number(v) <= 100_000, "maximum price is $100,000");

const httpsUrl = z.string().trim().url().refine((v) => v.startsWith("https://"), "must be an https:// link");

const networkEnum = z.enum(MERCHANT_NETWORKS as unknown as [PaymentNetwork, ...PaymentNetwork[]]);

export const deliverySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("github_repo"),
    repo: z.string().trim().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, "use owner/repo, e.g. acme/pro-templates"),
  }),
  z.object({ kind: z.literal("license_key"), machineLimit: z.number().int().min(1).max(100).default(3) }),
  z.object({ kind: z.literal("file"), fileUrl: httpsUrl }),
  z.object({
    kind: z.literal("discord_role"),
    guildId: z.string().trim().regex(/^\d{5,25}$/, "server id is numeric"),
    roleId: z.string().trim().regex(/^\d{5,25}$/, "role id is numeric"),
  }),
  z.object({ kind: z.literal("access"), accessUrl: httpsUrl.optional().or(z.literal("")) }),
]);

export const quickProductSchema = z
  .object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(""),
  priceUsd: usd,
  /**
   * Currency of `priceUsd` (default USD). Any other fiat currency settles in
   * USDC at the live rate locked on each checkout.
   */
  currency: z.enum(FIAT_CURRENCIES).default("USD"),
  interval: z.enum(["one_time", "monthly", "yearly"]).default("one_time"),
  delivery: deliverySchema,
  /** Subset of the merchant's networks this product accepts (all when omitted). */
  acceptedNetworks: z.array(networkEnum).optional(),
  })
  .refine((body) => body.currency === "USD" || body.interval === "one_time", {
    message: "subscriptions are priced in USD for now",
    path: ["currency"],
  });

export const productPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  priceUsd: usd.optional(),
  status: z.enum(["active", "archived"]).optional(),
  delivery: deliverySchema.optional(),
  acceptedNetworks: z.array(networkEnum).nullable().optional(),
});

export type QuickProductInput = z.infer<typeof quickProductSchema>;
export type ProductPatch = z.infer<typeof productPatchSchema>;

export interface MerchantProductView {
  id: string;
  name: string;
  description: string;
  status: Product["status"];
  priceUsd: string | null;
  /** Fiat price when the product is priced in another currency. */
  displayCurrency: string | null;
  displayAmount: string | null;
  priceId: string | null;
  interval: Price["interval"] | null;
  deliveryKind: DeliveryKind | "other";
  delivery: Record<string, unknown>;
  acceptedNetworks: PaymentNetwork[] | null;
  slug: string | null;
  createdAt: string;
}

/** A short, unguessable, URL-safe slug for a payment link. */
export function newSlug(name: string): string {
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const suffix = randomBytes(4).toString("hex");
  return stem ? `${stem}-${suffix}` : suffix;
}

function deliveryMetadata(delivery: QuickProductInput["delivery"]): Record<string, unknown> {
  switch (delivery.kind) {
    case "github_repo":
      return { deliveryKind: "github_repo", repoId: delivery.repo };
    case "license_key":
      return { deliveryKind: "license_key", machineLimit: delivery.machineLimit };
    case "file":
      return { deliveryKind: "file", fileUrl: delivery.fileUrl };
    case "discord_role":
      return { deliveryKind: "discord_role", guildId: delivery.guildId, roleId: delivery.roleId };
    case "access":
      return { deliveryKind: "access", ...(delivery.accessUrl ? { accessUrl: delivery.accessUrl } : {}), features: { access: true } };
  }
}

function kindOf(product: Product): DeliveryKind | "other" {
  const kind = product.metadata.deliveryKind;
  return typeof kind === "string" && (DELIVERY_KINDS as readonly string[]).includes(kind) ? (kind as DeliveryKind) : "other";
}

function publicDelivery(product: Product): Record<string, unknown> {
  const m = product.metadata;
  const pick = (k: string): Record<string, unknown> => (m[k] !== undefined ? { [k]: m[k] } : {});
  return { ...pick("repoId"), ...pick("machineLimit"), ...pick("fileUrl"), ...pick("guildId"), ...pick("roleId"), ...pick("accessUrl") };
}

function acceptedOf(product: Product): PaymentNetwork[] | null {
  const list = product.metadata.acceptedNetworks;
  return Array.isArray(list) ? (list.filter((n) => typeof n === "string") as PaymentNetwork[]) : null;
}

export function slugOf(product: Product): string | null {
  const slug = product.metadata.paymentLinkSlug;
  return typeof slug === "string" && slug.length > 0 ? slug : null;
}

/** The product's current price (newest active). */
export async function activePrice(ctx: AppContext, productId: string): Promise<Price | null> {
  const prices = await ctx.prices.list((p) => p.productId === productId && p.active);
  return prices.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

export async function productView(ctx: AppContext, product: Product): Promise<MerchantProductView> {
  const price = await activePrice(ctx, product.id);
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    status: product.status,
    priceUsd: price?.amount ?? null,
    displayCurrency: price?.displayCurrency ?? null,
    displayAmount: price?.displayAmount ?? null,
    priceId: price?.id ?? null,
    interval: price?.interval ?? null,
    deliveryKind: kindOf(product),
    delivery: publicDelivery(product),
    acceptedNetworks: acceptedOf(product),
    slug: slugOf(product),
    createdAt: product.createdAt,
  };
}

/**
 * A price in USD (USDC 1:1) or another fiat currency. A fiat price keeps its
 * display amount; `amount` is the USDC value at the current rate (reference).
 */
async function priceIn(
  ctx: AppContext,
  productId: string,
  amount: string,
  currency: FiatCurrency,
  interval: Price["interval"],
): Promise<Price> {
  if (currency === "USD") return newPrice(productId, amount, interval);
  const { rate } = await ctx.fxRates.usdPer(currency);
  return { ...newPrice(productId, fiatToUsdc(amount, rate), interval), displayCurrency: currency, displayAmount: amount };
}

function newPrice(productId: string, amount: string, interval: Price["interval"]): Price {
  return {
    id: generateId("price"),
    productId,
    amount,
    currency: "USDC",
    interval,
    usageBased: false,
    active: true,
    createdAt: new Date().toISOString(),
  };
}

/** Create, price and publish a product with a payment link in one step. */
export async function createQuickProduct(ctx: AppContext, organizationId: string, input: QuickProductInput): Promise<Product> {
  const map = KIND_MAP[input.delivery.kind];
  const draft = createProductDraft({
    merchantId: merchantIdFor(organizationId),
    organizationId,
    name: input.name,
    description: input.description,
    template: { type: map.type, deliveryMode: map.deliveryMode, requiredBuyerFields: [] },
    metadata: {
      ...deliveryMetadata(input.delivery),
      paymentLinkSlug: newSlug(input.name),
      ...(input.acceptedNetworks ? { acceptedNetworks: input.acceptedNetworks } : {}),
    },
  });
  // The product row must exist before its price: prices.product_id is a
  // foreign key in Postgres. Publish only once the price is in place.
  await ctx.products.save(draft);
  await ctx.prices.save(await priceIn(ctx, draft.id, input.priceUsd, input.currency, input.interval));
  const now = new Date().toISOString();
  return ctx.products.save({ ...draft, status: "active", updatedAt: now });
}

/** Apply a merchant edit; a new price supersedes (deactivates) the old one. */
export async function updateProduct(ctx: AppContext, product: Product, patch: ProductPatch): Promise<Product> {
  if (patch.priceUsd !== undefined) {
    const current = await activePrice(ctx, product.id);
    const currency = (current?.displayCurrency ?? "USD") as FiatCurrency;
    const unchanged = currency === "USD" ? current?.amount === patch.priceUsd : current?.displayAmount === patch.priceUsd;
    if (!unchanged) {
      if (current) await ctx.prices.save({ ...current, active: false });
      await ctx.prices.save(await priceIn(ctx, product.id, patch.priceUsd, currency, current?.interval ?? "one_time"));
    }
  }
  let metadata: Record<string, unknown> = { ...product.metadata };
  let type = product.type;
  let deliveryMode = product.deliveryMode;
  if (patch.delivery) {
    const map = KIND_MAP[patch.delivery.kind];
    for (const key of ["repoId", "machineLimit", "fileUrl", "guildId", "roleId", "accessUrl", "features"]) delete metadata[key];
    metadata = { ...metadata, ...deliveryMetadata(patch.delivery) };
    type = map.type;
    deliveryMode = map.deliveryMode;
  }
  if (patch.acceptedNetworks !== undefined) {
    const { acceptedNetworks: _drop, ...rest } = metadata;
    void _drop;
    metadata = patch.acceptedNetworks === null ? rest : { ...rest, acceptedNetworks: patch.acceptedNetworks };
  }
  if (!slugOf(product)) metadata = { ...metadata, paymentLinkSlug: newSlug(patch.name ?? product.name) };
  if (patch.status === "active" && !(await activePrice(ctx, product.id))) {
    throw validationError("set a price before activating the product");
  }
  return ctx.products.save({
    ...product,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    type,
    deliveryMode,
    metadata,
    updatedAt: new Date().toISOString(),
  });
}

/** Stable merchant id for an org (one merchant per self-serve org). */
export function merchantIdFor(organizationId: string): string {
  return `mch_${organizationId.replace(/^org(anization)?_/, "")}`;
}

/** Find the product a payment-link slug points at. */
export async function findBySlug(ctx: AppContext, slug: string): Promise<Product | null> {
  const [product] = await ctx.products.list((p) => slugOf(p) === slug);
  return product ?? null;
}
