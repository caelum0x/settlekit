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
import { isOwned, ownedPaymentIds, requireOwnedPayment } from "../http/tenant.js";
import type { Context } from "hono";
import type { Dispute } from "@settlekit/disputes";

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

/**
 * Load a dispute by id, requiring its payment belongs to the caller's org. A
 * foreign dispute answers 404 exactly like a missing one.
 */
async function ownedDispute(c: Context<AppEnv>, id: string): Promise<Dispute> {
  const ctx = c.get("ctx");
  const dispute = await ctx.disputes.get(id);
  if (!dispute || !isOwned(c, await ctx.payments.findById(dispute.paymentId))) {
    throw notFound(`dispute ${id} not found`, { id });
  }
  return dispute;
}

export function disputeRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const body = await parseBody(c, openSchema);
    // Tenant-scoped: disputes can only be opened on the caller's own payments.
    await requireOwnedPayment(c, body.paymentId);
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
    // Tenant-scoped: a dispute is visible only when its payment is ours.
    const owned = await ownedPaymentIds(c);
    const source =
      status === "open" || status === "under_review"
        ? await ctx.disputes.listOpen()
        : await ctx.disputeStore.listAll();
    const mine = source.filter((d) => owned.has(d.paymentId));
    if (status && status !== "open" && status !== "under_review") {
      return data(c, mine.filter((d) => d.status === status));
    }
    return data(c, mine);
  });

  app.get("/:id", async (c) => {
    return data(c, await ownedDispute(c, c.req.param("id")));
  });

  app.post("/:id/evidence", async (c) => {
    const { id } = await ownedDispute(c, c.req.param("id"));
    const body = await parseBody(c, evidenceSchema);
    const dispute = unwrapResult(
      await c.get("ctx").disputes.submitEvidence(id, {
        kind: body.kind,
        description: body.description,
        value: body.value,
      }),
    );
    return data(c, dispute);
  });

  app.post("/:id/resolve", async (c) => {
    const { id } = await ownedDispute(c, c.req.param("id"));
    const body = await parseBody(c, resolveSchema);
    const dispute = unwrapResult(await c.get("ctx").disputes.resolve(id, body.outcome));
    return data(c, dispute);
  });

  return app;
}
