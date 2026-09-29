/**
 * Everything an agent purchase must satisfy BEFORE a payment challenge is
 * issued or settled: the product exists and is published, it has a one-time
 * fixed price, and the buyer supplied every identity its delivery needs.
 * Failing here costs the agent nothing.
 */
import { z } from "zod";
import { notFound, validationError, type Price, type Product } from "@settlekit/common";
import type { AppContext } from "../context.js";
import { deliveryActionsFor, requiredBuyerFields } from "./delivery-action.js";
import type { BuyerDetails } from "./fulfil.js";

export const buyerSchema = z
  .object({
    email: z.string().email().optional(),
    githubUsername: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, "must be a GitHub login").optional(),
    discordUserId: z.string().regex(/^\d{5,25}$/, "must be a Discord user id").optional(),
  })
  .strict();

export interface Purchasable {
  product: Product;
  price: Price;
  buyer: BuyerDetails;
}

/** Parse the optional JSON body of a buy request (empty body = no buyer details). */
export async function readBuyer(request: Request): Promise<BuyerDetails> {
  const text = await request.clone().text();
  if (text.trim().length === 0) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw validationError("request body must be JSON");
  }
  const parsed = buyerSchema.safeParse(raw);
  if (!parsed.success) {
    throw validationError("invalid buyer details", { issues: parsed.error.issues.map((issue) => issue.message) });
  }
  return Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined)) as BuyerDetails;
}

/** Resolve the product, its one-time price and validated buyer details. */
export async function resolvePurchasable(ctx: AppContext, productId: string, buyer: BuyerDetails): Promise<Purchasable> {
  const product = await ctx.products.findById(productId);
  if (!product || product.status !== "active") throw notFound("product not found", { id: productId });
  const prices = await ctx.prices.list(
    (price) => price.productId === productId && price.active && price.interval === "one_time" && !price.usageBased,
  );
  const price = prices.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (!price) throw validationError("product has no active one-time price", { id: productId });

  const missing = requiredBuyerFields(deliveryActionsFor(product)).filter((field) => buyer[field] === undefined);
  if (missing.length > 0) {
    throw validationError(`delivery of this product needs: ${missing.join(", ")}`, { missing });
  }
  return { product, price, buyer };
}
