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
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { unwrapResult } from "../http/internal.js";

const createSchema = z.object({
  organizationId: z.string().min(1),
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

export function agentServiceRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const body = await parseBody(c, createSchema);
    const svc = unwrapResult(
      await c.get("ctx").agentServices.create({
        organizationId: body.organizationId,
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
    const orgId = c.req.query("organizationId");
    const list = await c.get("ctx").agentServices.discover(
      orgId ? { organizationId: orgId } : {},
    );
    return data(c, list);
  });

  app.get("/:id", async (c) => {
    const svc = unwrapResult(await c.get("ctx").agentServices.get(c.req.param("id")));
    return data(c, svc);
  });

  // Patch mutable fields, persisting through the store.
  app.patch("/:id", async (c) => {
    const ctx = c.get("ctx");
    const current = unwrapResult(await ctx.agentServices.get(c.req.param("id")));
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
    const svc = unwrapResult(await c.get("ctx").agentServices.publish(c.req.param("id")));
    return data(c, svc);
  });

  // Machine-readable metadata document (plan §11). Served as raw JSON, not enveloped.
  app.get("/:id/metadata.json", async (c) => {
    const metadata = unwrapResult(await c.get("ctx").agentServices.metadata(c.req.param("id")));
    return c.json(metadata);
  });

  return app;
}
