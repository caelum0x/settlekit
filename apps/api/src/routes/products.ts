/**
 * Product + price routes (plan §2, §15).
 *
 * Products are created/listed/published through the real `@settlekit/product-catalog`
 * domain functions; persistence uses the in-memory product store on the context.
 * Prices attach to a product and feed checkout total math downstream.
 */
import { Hono, type Context } from "hono";
import { z } from "zod";
import { FIAT_CURRENCIES, fiatToUsdc, generateId, type Price, type Product } from "@settlekit/common";
import { createProductDraft, publishProduct } from "@settlekit/product-catalog";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { requireOrg, requireOwned } from "../http/tenant.js";
import { isInvoiceProduct } from "../merchant/invoice-payments.js";
import { assertCanCreateProduct } from "../platform/fee-statements.js";

const PRODUCT_TYPES = [
  "saas_plan",
  "github_repo_access",
  "github_org_team_access",
  "api_access",
  "paid_api_call",
  "ai_agent_service",
  "digital_download",
  "code_template",
  "dataset",
  "license_key",
  "private_package",
  "discord_access",
  "support_plan",
  "course_or_content",
  "consulting_slot",
  "escrow_task",
  "bundle",
] as const;

const DELIVERY_MODES = [
  "github_invite",
  "github_team_add",
  "license_key",
  "api_key",
  "file_download",
  "discord_role",
  "saas_entitlement",
  "webhook",
  "email",
  "bundle",
  "none",
] as const;

const createProductSchema = z.object({
  merchantId: z.string().min(1),
  // Derived from the authenticated org (tenant scope); ignored if supplied.
  organizationId: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().default(""),
  type: z.enum(PRODUCT_TYPES),
  deliveryMode: z.enum(DELIVERY_MODES),
  metadata: z.record(z.unknown()).default({}),
});

const createPriceSchema = z
  .object({
    /** USDC amount; optional when the price is set in a fiat currency. */
    amount: z.string().regex(/^\d+(\.\d+)?$/, "amount must be a decimal string").optional(),
    currency: z.literal("USDC").default("USDC"),
    interval: z.enum(["one_time", "monthly", "yearly"]).default("one_time"),
    usageBased: z.boolean().default(false),
    unitAmount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
    creditsGranted: z.number().int().positive().optional(),
    /** Price in a fiat currency; settles in USDC at the live rate per checkout. */
    displayCurrency: z.enum(FIAT_CURRENCIES).optional(),
    displayAmount: z.string().regex(/^\d+(\.\d{1,2})?$/, "displayAmount must be like 29 or 29.99").optional(),
  })
  .superRefine((body, ctx) => {
    const fiat = body.displayCurrency !== undefined || body.displayAmount !== undefined;
    if (fiat && (body.displayCurrency === undefined || body.displayAmount === undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["displayAmount"], message: "set displayCurrency and displayAmount together" });
    }
    if (!fiat && body.amount === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amount"], message: "amount is required" });
    }
    if (fiat && body.interval !== "one_time") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["displayCurrency"], message: "subscriptions are priced in USD for now" });
    }
    if (fiat && body.usageBased) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["usageBased"], message: "usage prices are set in USDC" });
    }
  });

/** Load a product by id, requiring it belongs to the caller's org (else 404). */
async function ownedProduct(c: Context<AppEnv>, id: string): Promise<Product> {
  return requireOwned(c, await c.get("ctx").products.findById(id), "product", id);
}

export function productRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Create a product (draft).
  app.post("/", async (c) => {
    const body = await parseBody(c, createProductSchema);
    // Tenant-scoped: the product belongs to the caller's org, never a
    // client-supplied organizationId (which would allow cross-tenant writes).
    const draft = createProductDraft({
      merchantId: body.merchantId,
      organizationId: requireOrg(c),
      name: body.name,
      description: body.description,
      template: {
        type: body.type,
        deliveryMode: body.deliveryMode,
        requiredBuyerFields: [],
      },
      metadata: body.metadata,
    });
    const saved = await c.get("ctx").products.save(draft);
    return created(c, saved);
  });

  // List products.
  app.get("/", async (c) => {
    // Tenant-scoped: only the authenticated organization's products.
    const org = requireOrg(c);
    const products = await c.get("ctx").products.list((p) => p.organizationId === org && !isInvoiceProduct(p));
    return data(c, products);
  });

  // Get a product.
  app.get("/:id", async (c) => {
    return data(c, await ownedProduct(c, c.req.param("id")));
  });

  // Publish a product (requires an active price).
  app.post("/:id/publish", async (c) => {
    const ctx = c.get("ctx");
    const id = c.req.param("id");
    const product = await ownedProduct(c, id);
    if (product.status !== "active") await assertCanCreateProduct(ctx, product.organizationId);
    const prices = await ctx.prices.list((p) => p.productId === id);
    const published = publishProduct(product, prices);
    return data(c, await ctx.products.save(published));
  });

  // Create a price for a product.
  app.post("/:id/prices", async (c) => {
    const ctx = c.get("ctx");
    const productId = c.req.param("id");
    await ownedProduct(c, productId);

    const body = await parseBody(c, createPriceSchema);
    const fiat = body.displayCurrency !== undefined && body.displayAmount !== undefined;
    // USDC reference value at creation; each checkout re-converts at the live rate.
    const amount = fiat
      ? fiatToUsdc(body.displayAmount!, (await ctx.fxRates.usdPer(body.displayCurrency!)).rate)
      : body.amount!;
    const price: Price = {
      id: generateId("price"),
      productId,
      amount,
      ...(fiat ? { displayCurrency: body.displayCurrency!, displayAmount: body.displayAmount! } : {}),
      currency: body.currency,
      interval: body.interval,
      usageBased: body.usageBased,
      ...(body.unitAmount !== undefined ? { unitAmount: body.unitAmount } : {}),
      ...(body.creditsGranted !== undefined ? { creditsGranted: body.creditsGranted } : {}),
      active: true,
      createdAt: new Date().toISOString(),
    };
    return created(c, await ctx.prices.save(price));
  });

  // List prices for a product.
  app.get("/:id/prices", async (c) => {
    const productId = c.req.param("id");
    await ownedProduct(c, productId);
    const prices = await c.get("ctx").prices.list((p) => p.productId === productId);
    return data(c, prices);
  });

  return app;
}
