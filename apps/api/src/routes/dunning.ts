/**
 * Dunning routes — the failed-payment recovery engine over the REAL
 * `@settlekit/dunning` `DunningService` (in-memory store on the app context).
 *
 *   POST /v1/dunning                          start a campaign for a subscription
 *   GET  /v1/dunning?due=true                  list active (or only due) campaigns
 *   POST /v1/dunning/:subscriptionId/attempt   record a retry attempt outcome
 *   POST /v1/dunning/:subscriptionId/recover   mark a campaign recovered
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { unwrapResult } from "../http/internal.js";

const startSchema = z.object({
  subscriptionId: z.string().min(1),
});

const attemptSchema = z.object({
  outcome: z.enum(["recovered", "failed"]),
  failureReason: z.string().min(1).optional(),
});

export function dunningRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const body = await parseBody(c, startSchema);
    const state = unwrapResult(await c.get("ctx").dunning.start(body.subscriptionId));
    return created(c, state);
  });

  app.get("/", async (c) => {
    const ctx = c.get("ctx");
    const due = c.req.query("due");
    if (due === "true" || due === "1") {
      return data(c, await ctx.dunning.listDue());
    }
    return data(c, await ctx.dunning.listActive());
  });

  app.post("/:subscriptionId/attempt", async (c) => {
    const body = await parseBody(c, attemptSchema);
    // A "recovered" outcome closes the campaign; "failed" advances/exhausts it.
    const ctx = c.get("ctx");
    const subscriptionId = c.req.param("subscriptionId");
    if (body.outcome === "recovered") {
      const state = unwrapResult(await ctx.dunning.recover(subscriptionId));
      return data(c, state);
    }
    const state = unwrapResult(
      await ctx.dunning.recordAttempt(subscriptionId, "failed", body.failureReason),
    );
    return data(c, state);
  });

  app.post("/:subscriptionId/recover", async (c) => {
    const state = unwrapResult(await c.get("ctx").dunning.recover(c.req.param("subscriptionId")));
    return data(c, state);
  });

  return app;
}
