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
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { EscrowTask } from "@settlekit/common";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { requireOrg, requireOwned } from "../http/tenant.js";

const createSchema = z.object({
  // Derived from the authenticated org (tenant scope); ignored if supplied.
  organizationId: z.string().min(1).optional(),
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

/** Load the `:id` escrow task, requiring it belongs to the caller's org (else 404). */
async function ownedTask(c: Context<AppEnv>): Promise<EscrowTask> {
  const id = c.req.param("id") ?? "";
  return requireOwned(c, await c.get("ctx").escrow.getTask(id), "escrow task", id);
}

export function escrowRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/tasks", async (c) => {
    const body = await parseBody(c, createSchema);
    const task = await c.get("ctx").escrow.createTask({
      organizationId: requireOrg(c),
      buyerCustomerId: body.buyerCustomerId,
      title: body.title,
      description: body.description,
      amount: body.amount,
      currency: body.currency,
    });
    return created(c, task);
  });

  // Tenant-scoped: only the authenticated org's tasks (any organizationId
  // query param is ignored).
  app.get("/tasks", async (c) => {
    return data(c, await c.get("ctx").escrow.listTasks(requireOrg(c)));
  });

  app.get("/tasks/:id", async (c) => {
    return data(c, await ownedTask(c));
  });

  app.post("/tasks/:id/fund", async (c) => {
    const { id } = await ownedTask(c);
    const body = await parseBody(c, fundSchema);
    return data(c, await c.get("ctx").escrow.fundTask(id, body.fundingTxHash));
  });

  app.post("/tasks/:id/assign", async (c) => {
    const { id } = await ownedTask(c);
    const body = await parseBody(c, assignSchema);
    return data(c, await c.get("ctx").escrow.assignWorker(id, body.workerCustomerId));
  });

  app.post("/tasks/:id/submit", async (c) => {
    const { id } = await ownedTask(c);
    const body = await parseBody(c, submitSchema);
    return data(c, await c.get("ctx").escrow.submitWork(id, body.content));
  });

  app.post("/tasks/:id/approve", async (c) => {
    const { id } = await ownedTask(c);
    return data(c, await c.get("ctx").escrow.approve(id));
  });

  app.post("/tasks/:id/release", async (c) => {
    const { id } = await ownedTask(c);
    const body = await parseBody(c, releaseSchema);
    return data(c, await c.get("ctx").escrow.release(id, body.releaseTxHash));
  });

  app.post("/tasks/:id/refund", async (c) => {
    const { id } = await ownedTask(c);
    const body = await parseBody(c, refundSchema);
    return data(c, await c.get("ctx").escrow.refund(id, body.reason));
  });

  return app;
}
