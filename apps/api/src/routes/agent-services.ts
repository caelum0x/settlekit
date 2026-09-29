/**
 * Agent service routes (plan §26, §11).
 *
 * Marketplace listings for AI/agent tools, backed by the REAL
 * `@settlekit/agent-services` `AgentServiceService`.
 *
 *   POST/GET  /v1/agent-services
 *   GET/PATCH /v1/agent-services/:id
 *   POST      /v1/agent-services/:id/publish
 *   GET       /v1/agent-services/:id/metadata.json  — machine-readable metadata
 */
import { Hono, type Context } from "hono";
import type { AgentService } from "@settlekit/common";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { unwrapResult } from "../http/internal.js";
import { requireOrg, requireOwned } from "../http/tenant.js";

const createSchema = z.object({
  // Derived from the authenticated org (tenant scope); ignored if supplied.
  organizationId: z.string().min(1).optional(),
  merchantId: z.string().min(1),
  productId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  endpoint: z.string().url(),
  price: z.string().regex(/^\d+(\.\d+)?$/),
  network: z.enum(["arc", "base"]).default("base"),
  inputSchema: z.record(z.unknown()),
  outputSchema: z.record(z.unknown()).optional(),
});

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  endpoint: z.string().url().optional(),
  price: z.string().regex(/^\d+(\.\d+)?$/).optional(),
});

/** Load an agent service by id, requiring it belongs to the caller's org (else 404). */
async function ownedService(c: Context<AppEnv>, id: string): Promise<AgentService> {
  const found = await c.get("ctx").agentServices.get(id);
  return requireOwned(c, found.ok ? found.value : undefined, "agent service", id);
}

export function agentServiceRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const body = await parseBody(c, createSchema);
    const svc = unwrapResult(
      await c.get("ctx").agentServices.create({
        organizationId: requireOrg(c),
        merchantId: body.merchantId,
        productId: body.productId,
        name: body.name,
        description: body.description,
        endpoint: body.endpoint,
        price: body.price,
        network: body.network,
        inputSchema: body.inputSchema,
        ...(body.outputSchema !== undefined ? { outputSchema: body.outputSchema } : {}),
      }),
    );
    return created(c, svc);
  });

  app.get("/", async (c) => {
    // Tenant-scoped: only the authenticated organization's services.
    const list = await c.get("ctx").agentServices.discover({ organizationId: requireOrg(c) });
    return data(c, list);
  });

  app.get("/:id", async (c) => {
    return data(c, await ownedService(c, c.req.param("id")));
  });

  // Patch mutable fields, persisting through the store.
  app.patch("/:id", async (c) => {
    const ctx = c.get("ctx");
    const current = await ownedService(c, c.req.param("id"));
    const body = await parseBody(c, patchSchema);
    const updated = {
      ...current,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.endpoint !== undefined ? { endpoint: body.endpoint } : {}),
      ...(body.price !== undefined ? { price: body.price } : {}),
    };
    return data(c, await ctx.agentServiceStore.save(updated));
  });

  app.post("/:id/publish", async (c) => {
    const { id } = await ownedService(c, c.req.param("id"));
    const svc = unwrapResult(await c.get("ctx").agentServices.publish(id));
    return data(c, svc);
  });

  // Machine-readable metadata document (plan §11). Served as raw JSON, not enveloped.
  app.get("/:id/metadata.json", async (c) => {
    const { id } = await ownedService(c, c.req.param("id"));
    const metadata = unwrapResult(await c.get("ctx").agentServices.metadata(id));
    return c.json(metadata);
  });

  return app;
}
