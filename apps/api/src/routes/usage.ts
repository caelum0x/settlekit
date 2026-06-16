/**
 * Usage-based billing routes (plan §4 usage limits, §5 paid APIs, §31 usage
 * billing) — metering + prepaid credits over the REAL `@settlekit/usage`
 * `UsageService`, persisted via the shared meter store.
 *
 *   POST /v1/usage/record               record N units of a metric
 *   GET  /v1/usage/meter                read a meter for a period
 *   POST /v1/usage/charge               compute the charge for a meter's usage
 *   POST /v1/usage/limit                evaluate usage against a hard limit
 *   GET  /v1/usage/credits              read a prepaid balance
 *   POST /v1/usage/credits/grant        grant prepaid credits
 *   POST /v1/usage/credits/consume      consume prepaid credits (meter a paid call)
 */
import { Hono } from "hono";
import { z } from "zod";
import { money } from "@settlekit/common";
import type { AppEnv } from "../context.js";
import { data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";

const amount = z.string().regex(/^\d+(\.\d+)?$/);

const meterRef = z.object({
  organizationId: z.string().min(1),
  customerId: z.string().min(1),
  productId: z.string().min(1),
  metric: z.string().min(1),
});

const balanceRef = z.object({
  organizationId: z.string().min(1),
  customerId: z.string().min(1),
  productId: z.string().min(1),
});

const recordSchema = meterRef.extend({
  quantity: z.number().int().min(1).default(1),
  periodStart: z.string().datetime().optional(),
});

const chargeSchema = meterRef.extend({
  unitAmount: amount,
  periodStart: z.string().datetime().optional(),
});

const limitSchema = meterRef.extend({
  limit: z.number().int().min(0),
  periodStart: z.string().datetime().optional(),
});

const grantSchema = balanceRef.extend({ credits: z.number().int().min(1) });
const consumeSchema = balanceRef.extend({ credits: z.number().int().min(1).default(1) });

/** Resolve the period-start Date for a request (defaults to now). */
function periodStart(iso?: string): Date {
  return iso ? new Date(iso) : new Date();
}

export function usageRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Record usage for a metric (creates the meter on first use).
  app.post("/record", async (c) => {
    const body = await parseBody(c, recordSchema);
    const meter = await c.get("ctx").usage.record(
      { organizationId: body.organizationId, customerId: body.customerId, productId: body.productId, metric: body.metric },
      body.quantity,
      periodStart(body.periodStart),
    );
    return data(c, meter);
  });

  // Read the current meter for a metric/period.
  app.get("/meter", async (c) => {
    const ref = meterRef.parse({
      organizationId: c.req.query("organizationId"),
      customerId: c.req.query("customerId"),
      productId: c.req.query("productId"),
      metric: c.req.query("metric"),
    });
    const meter = await c.get("ctx").usage.getMeter(ref, periodStart(c.req.query("periodStart")));
    return data(c, meter);
  });

  // Compute the charge for a meter's usage at a unit price.
  app.post("/charge", async (c) => {
    const body = await parseBody(c, chargeSchema);
    const charge = await c.get("ctx").usage.charge(
      { organizationId: body.organizationId, customerId: body.customerId, productId: body.productId, metric: body.metric },
      periodStart(body.periodStart),
      money(body.unitAmount),
    );
    return data(c, charge);
  });

  // Evaluate usage against a hard limit.
  app.post("/limit", async (c) => {
    const body = await parseBody(c, limitSchema);
    const check = await c.get("ctx").usage.limit(
      { organizationId: body.organizationId, customerId: body.customerId, productId: body.productId, metric: body.metric },
      periodStart(body.periodStart),
      body.limit,
    );
    return data(c, check);
  });

  // Read a prepaid credit balance.
  app.get("/credits", async (c) => {
    const ref = balanceRef.parse({
      organizationId: c.req.query("organizationId"),
      customerId: c.req.query("customerId"),
      productId: c.req.query("productId"),
    });
    const balance = await c.get("ctx").usage.getBalance(ref);
    return data(c, balance);
  });

  // Grant prepaid credits (e.g. after a credit pack purchase).
  app.post("/credits/grant", async (c) => {
    const body = await parseBody(c, grantSchema);
    const balance = await c.get("ctx").usage.grant(
      { organizationId: body.organizationId, customerId: body.customerId, productId: body.productId },
      body.credits,
    );
    return data(c, balance);
  });

  // Consume prepaid credits (meter a paid API call / agent invocation).
  app.post("/credits/consume", async (c) => {
    const body = await parseBody(c, consumeSchema);
    const balance = await c.get("ctx").usage.consume(
      { organizationId: body.organizationId, customerId: body.customerId, productId: body.productId },
      body.credits,
    );
    return data(c, balance);
  });

  return app;
}
