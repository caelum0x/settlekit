/**
 * Product + price routes (plan §2, §15).
 *
 * Products are created/listed/published through the real `@settlekit/product-catalog`
 * domain functions; persistence uses the in-memory product store on the context.
 * Prices attach to a product and feed checkout total math downstream.
 */
import { Hono } from "hono";
import { z } from "zod";
import { generateId, notFound, type Price } from "@settlekit/common";
import { createProductDraft, publishProduct } from "@settlekit/product-catalog";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";

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
  organizationId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  type: z.enum(PRODUCT_TYPES),
  deliveryMode: z.enum(DELIVERY_MODES),
  metadata: z.record(z.unknown()).default({}),
});

const createPriceSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d+)?$/, "amount must be a decimal string"),
  currency: z.literal("USDC").default("USDC"),
  interval: z.enum(["one_time", "monthly", "yearly"]).default("one_time"),
  usageBased: z.boolean().default(false),
  unitAmount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  creditsGranted: z.number().int().positive().optional(),
});

export function productRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Create a product (draft).
  app.post("/", async (c) => {
    const body = await parseBody(c, createProductSchema);
    const draft = createProductDraft({
      merchantId: body.merchantId,
      organizationId: body.organizationId,
      name: body.name,
      description: body.description,
      template: {
        type: body.type,
        deliveryMode: body.deliveryMode,
        requiredBuyerFields: [],
      },
      metadata: body.metadata,
    });
    const saved = c.get("ctx").products.save(draft);
    return created(c, saved);
  });

  // List products.
  app.get("/", (c) => {
    const products = c.get("ctx").products.list();
    return data(c, products);
  });

  // Get a product.
  app.get("/:id", (c) => {
    const product = c.get("ctx").products.findById(c.req.param("id"));
    if (!product) throw notFound("product not found", { id: c.req.param("id") });
    return data(c, product);
  });

  // Publish a product (requires an active price).
  app.post("/:id/publish", (c) => {
    const ctx = c.get("ctx");
    const id = c.req.param("id");
    const product = ctx.products.findById(id);
    if (!product) throw notFound("product not found", { id });
    const prices = ctx.prices.list((p) => p.productId === id);
    const published = publishProduct(product, prices);
    return data(c, ctx.products.save(published));
  });

  // Create a price for a product.
  app.post("/:id/prices", async (c) => {
    const ctx = c.get("ctx");
    const productId = c.req.param("id");
    const product = ctx.products.findById(productId);
    if (!product) throw notFound("product not found", { id: productId });

    const body = await parseBody(c, createPriceSchema);
    const price: Price = {
      id: generateId("price"),
      productId,
      amount: body.amount,
      currency: body.currency,
      interval: body.interval,
      usageBased: body.usageBased,
      ...(body.unitAmount !== undefined ? { unitAmount: body.unitAmount } : {}),
      ...(body.creditsGranted !== undefined ? { creditsGranted: body.creditsGranted } : {}),
      active: true,
      createdAt: new Date().toISOString(),
    };
    return created(c, ctx.prices.save(price));
  });

  // List prices for a product.
  app.get("/:id/prices", (c) => {
    const productId = c.req.param("id");
    const prices = c.get("ctx").prices.list((p) => p.productId === productId);
    return data(c, prices);
  });

  return app;
}
