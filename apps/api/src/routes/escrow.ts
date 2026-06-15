/**
 * Escrow routes (plan §26, §12).
 *
 * Milestone escrow for agent/consulting work, backed by the REAL
 * `@settlekit/escrow` `EscrowService` state machine.
 *
 *   POST/GET /v1/escrow/tasks
 *   POST     /v1/escrow/tasks/:id/fund
 *   POST     /v1/escrow/tasks/:id/submit
 *   POST     /v1/escrow/tasks/:id/approve
 *   POST     /v1/escrow/tasks/:id/refund
 *
 * (assign / release / dispute are also exposed for a complete lifecycle.)
 */
import { Hono } from "hono";
import { z } from "zod";
import { notFound } from "@settlekit/common";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";

const createSchema = z.object({
  organizationId: z.string().min(1),
  buyerCustomerId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  currency: z.literal("USDC").default("USDC"),
});

const fundSchema = z.object({ fundingTxHash: z.string().min(1) });
const assignSchema = z.object({ workerCustomerId: z.string().min(1) });
const submitSchema = z.object({ content: z.string().min(1) });
const releaseSchema = z.object({ releaseTxHash: z.string().min(1) });
const refundSchema = z.object({ reason: z.string().min(1).default("refunded via API") });

export function escrowRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/tasks", async (c) => {
    const body = await parseBody(c, createSchema);
    const task = await c.get("ctx").escrow.createTask({
      organizationId: body.organizationId,
      buyerCustomerId: body.buyerCustomerId,
      title: body.title,
      description: body.description,
      amount: body.amount,
      currency: body.currency,
    });
    return created(c, task);
  });

  app.get("/tasks", async (c) => {
    const orgId = c.req.query("organizationId");
    if (!orgId) throw notFound("organizationId query param is required");
    return data(c, await c.get("ctx").escrow.listTasks(orgId));
  });

  app.get("/tasks/:id", async (c) => {
    const task = await c.get("ctx").escrow.getTask(c.req.param("id"));
    if (!task) throw notFound("escrow task not found", { id: c.req.param("id") });
    return data(c, task);
  });

  app.post("/tasks/:id/fund", async (c) => {
    const body = await parseBody(c, fundSchema);
    return data(c, await c.get("ctx").escrow.fundTask(c.req.param("id"), body.fundingTxHash));
  });

  app.post("/tasks/:id/assign", async (c) => {
    const body = await parseBody(c, assignSchema);
    return data(c, await c.get("ctx").escrow.assignWorker(c.req.param("id"), body.workerCustomerId));
  });

  app.post("/tasks/:id/submit", async (c) => {
    const body = await parseBody(c, submitSchema);
    return data(c, await c.get("ctx").escrow.submitWork(c.req.param("id"), body.content));
  });

  app.post("/tasks/:id/approve", async (c) => {
    return data(c, await c.get("ctx").escrow.approve(c.req.param("id")));
  });

  app.post("/tasks/:id/release", async (c) => {
    const body = await parseBody(c, releaseSchema);
    return data(c, await c.get("ctx").escrow.release(c.req.param("id"), body.releaseTxHash));
  });

  app.post("/tasks/:id/refund", async (c) => {
    const body = await parseBody(c, refundSchema);
    return data(c, await c.get("ctx").escrow.refund(c.req.param("id"), body.reason));
  });

  return app;
}
