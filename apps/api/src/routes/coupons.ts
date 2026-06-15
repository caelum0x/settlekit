/**
 * Coupon routes — the discount engine over the REAL `@settlekit/coupons`
 * `CouponService` (in-memory store on the app context).
 *
 *   POST /v1/coupons                  create a coupon
 *   GET  /v1/coupons                  list coupons
 *   GET  /v1/coupons/:code            fetch one by code
 *   POST /v1/coupons/:code/validate   dry-run apply against a subtotal
 *   POST /v1/coupons/:code/redeem     redeem against a subtotal (mutates count)
 */
import { Hono } from "hono";
import { z } from "zod";
import { money, type Money } from "@settlekit/common";
import type { CouponDiscount } from "@settlekit/coupons";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { unwrapResult } from "../http/internal.js";

const amount = z.string().regex(/^\d+(\.\d+)?$/);

const discountSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("percent"), percentOff: z.number().int().min(1).max(100) }),
  z.object({ type: z.literal("amount"), amountOff: amount }),
  z.object({ type: z.literal("free-trial-days"), days: z.number().int().min(1) }),
]);

const createSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1).optional(),
  discount: discountSchema,
  status: z.enum(["active", "archived"]).optional(),
  startsAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  maxRedemptions: z.number().int().min(1).optional(),
  perCustomerLimit: z.number().int().min(1).optional(),
  minSubtotal: amount.optional(),
  appliesToProductIds: z.array(z.string().min(1)).optional(),
});

const applySchema = z.object({
  subtotal: amount,
  customerId: z.string().min(1).optional(),
});

function toDiscount(input: z.infer<typeof discountSchema>): CouponDiscount {
  if (input.type === "amount") return { type: "amount", amountOff: money(input.amountOff) };
  if (input.type === "percent") return { type: "percent", percentOff: input.percentOff };
  return { type: "free-trial-days", days: input.days };
}

export function couponRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const body = await parseBody(c, createSchema);
    const minSubtotal: Money | undefined = body.minSubtotal ? money(body.minSubtotal) : undefined;
    const coupon = unwrapResult(
      await c.get("ctx").coupons.create({
        code: body.code,
        ...(body.name !== undefined ? { name: body.name } : {}),
        discount: toDiscount(body.discount),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.startsAt !== undefined ? { startsAt: body.startsAt } : {}),
        ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
        ...(body.maxRedemptions !== undefined ? { maxRedemptions: body.maxRedemptions } : {}),
        ...(body.perCustomerLimit !== undefined ? { perCustomerLimit: body.perCustomerLimit } : {}),
        ...(minSubtotal !== undefined ? { minSubtotal } : {}),
        ...(body.appliesToProductIds !== undefined ? { appliesToProductIds: body.appliesToProductIds } : {}),
      }),
    );
    return created(c, coupon);
  });

  app.get("/", async (c) => {
    const coupons = await c.get("ctx").coupons.list();
    return data(c, coupons);
  });

  app.get("/:code", async (c) => {
    const coupon = unwrapResult(await c.get("ctx").coupons.get(c.req.param("code")));
    return data(c, coupon);
  });

  app.post("/:code/validate", async (c) => {
    const body = await parseBody(c, applySchema);
    const result = unwrapResult(
      await c.get("ctx").coupons.validate(c.req.param("code"), money(body.subtotal), {
        ...(body.customerId !== undefined ? { customerId: body.customerId } : {}),
      }),
    );
    return data(c, result);
  });

  app.post("/:code/redeem", async (c) => {
    const body = await parseBody(c, applySchema);
    const outcome = unwrapResult(
      await c.get("ctx").coupons.redeem(c.req.param("code"), money(body.subtotal), {
        ...(body.customerId !== undefined ? { customerId: body.customerId } : {}),
      }),
    );
    return data(c, outcome);
  });

  return app;
}
