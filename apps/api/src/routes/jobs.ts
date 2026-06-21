/**
 * Agent job routes (`/v1/jobs`) — an off-chain, org-scoped mirror of the
 * ERC-8183 job lifecycle: create → fund → submit → evaluate → settle (or
 * refund/cancel). Status transitions are guarded by a forward-only state
 * machine so a job can't, e.g., settle before it's evaluated.
 */
import { Hono } from "hono";
import { z } from "zod";
import { SettleKitError } from "@settlekit/common";
import type { JobStatus } from "@settlekit/persistence";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { requireOrg } from "../http/tenant.js";

const createSchema = z.object({
  requester: z.string().min(1),
  worker: z.string().min(1),
  amountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/, "amountUsdc must be a decimal"),
});

const transitionSchema = z.object({
  to: z.enum(["funded", "submitted", "evaluated", "settled", "refunded", "cancelled"]),
  deliverableUri: z.string().min(1).optional(),
});

/** Legal forward transitions; terminal states have none. */
const NEXT: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  created: ["funded", "cancelled"],
  funded: ["submitted", "refunded", "cancelled"],
  submitted: ["evaluated", "refunded"],
  evaluated: ["settled", "refunded"],
  settled: [],
  refunded: [],
  cancelled: [],
};

function err(code: "not_found" | "conflict", message: string): SettleKitError {
  return new SettleKitError({ code, message });
}

export function jobRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // POST /v1/jobs -> create a job (status: created).
  app.post("/", async (c) => {
    const body = await parseBody(c, createSchema);
    const job = await c.get("ctx").agentJobs.createJob({
      organizationId: requireOrg(c),
      requester: body.requester,
      worker: body.worker,
      amountUsdc: body.amountUsdc,
    });
    return created(c, job);
  });

  // GET /v1/jobs -> list the org's jobs.
  app.get("/", async (c) => {
    const jobs = await c.get("ctx").agentJobs.listJobs(requireOrg(c));
    return data(c, jobs);
  });

  // GET /v1/jobs/:id -> fetch one job.
  app.get("/:id", async (c) => {
    const job = await c.get("ctx").agentJobs.getJob(requireOrg(c), c.req.param("id"));
    if (!job) throw err("not_found", "Job not found");
    return data(c, job);
  });

  // POST /v1/jobs/:id/transition -> advance the job lifecycle (guarded).
  app.post("/:id/transition", async (c) => {
    const org = requireOrg(c);
    const id = c.req.param("id");
    const body = await parseBody(c, transitionSchema);
    const ctx = c.get("ctx");

    const job = await ctx.agentJobs.getJob(org, id);
    if (!job) throw err("not_found", "Job not found");
    if (!NEXT[job.status].includes(body.to)) {
      throw err("conflict", `Cannot transition a ${job.status} job to ${body.to}`);
    }
    const updated = await ctx.agentJobs.updateJob(org, id, {
      status: body.to,
      ...(body.deliverableUri !== undefined ? { deliverableUri: body.deliverableUri } : {}),
    });
    if (!updated) throw err("not_found", "Job not found");
    return data(c, updated);
  });

  return app;
}
