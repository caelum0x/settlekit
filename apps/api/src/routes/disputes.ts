/**
 * Dispute routes — the chargeback / dispute engine over the REAL
 * `@settlekit/disputes` `DisputeService` (in-memory store on the app context).
 *
 *   POST /v1/disputes                  open a dispute
 *   GET  /v1/disputes?status=open       list (optionally filtered by status)
 *   GET  /v1/disputes/:id               fetch one
 *   POST /v1/disputes/:id/evidence      attach evidence (-> under_review)
 *   POST /v1/disputes/:id/resolve       resolve won | lost | refunded
 */
import { Hono } from "hono";
import { z } from "zod";
import { notFound } from "@settlekit/common";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { unwrapResult } from "../http/internal.js";

const openSchema = z.object({
  paymentId: z.string().min(1),
  customerId: z.string().min(1),
  reason: z.enum(["fraud", "not_received", "duplicate", "quality", "unrecognized"]),
});

const evidenceSchema = z.object({
  kind: z.enum(["text", "receipt", "shipping", "communication", "url", "file"]),
  description: z.string().min(1),
  value: z.string().min(1),
});

const resolveSchema = z.object({
  outcome: z.enum(["won", "lost", "refunded"]),
});

export function disputeRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const body = await parseBody(c, openSchema);
    const dispute = unwrapResult(
      await c.get("ctx").disputes.open({
        paymentId: body.paymentId,
        customerId: body.customerId,
        reason: body.reason,
      }),
    );
    return created(c, dispute);
  });

  app.get("/", async (c) => {
    const ctx = c.get("ctx");
    const status = c.req.query("status");
    if (status === "open" || status === "under_review") {
      return data(c, await ctx.disputes.listOpen());
    }
    const all = await ctx.disputeStore.listAll();
    if (status) {
      return data(c, all.filter((d) => d.status === status));
    }
    return data(c, all);
  });

  app.get("/:id", async (c) => {
    const dispute = await c.get("ctx").disputes.get(c.req.param("id"));
    if (!dispute) {
      throw notFound(`dispute ${c.req.param("id")} not found`);
    }
    return data(c, dispute);
  });

  app.post("/:id/evidence", async (c) => {
    const body = await parseBody(c, evidenceSchema);
    const dispute = unwrapResult(
      await c.get("ctx").disputes.submitEvidence(c.req.param("id"), {
        kind: body.kind,
        description: body.description,
        value: body.value,
      }),
    );
    return data(c, dispute);
  });

  app.post("/:id/resolve", async (c) => {
    const body = await parseBody(c, resolveSchema);
    const dispute = unwrapResult(await c.get("ctx").disputes.resolve(c.req.param("id"), body.outcome));
    return data(c, dispute);
  });

  return app;
}
