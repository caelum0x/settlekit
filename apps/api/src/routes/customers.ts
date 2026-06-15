/**
 * Customer routes (plan §2).
 *
 * Customers carry the external identity hooks (github username, discord user id,
 * wallet) that delivery actions consume. Stored in the in-memory customer store.
 */
import { Hono } from "hono";
import { z } from "zod";
import { generateId, notFound, type Customer } from "@settlekit/common";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";

const createCustomerSchema = z.object({
  organizationId: z.string().min(1),
  email: z.string().email(),
  name: z.string().optional(),
  walletAddress: z.string().optional(),
  githubUsername: z.string().optional(),
  discordUserId: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export function customerRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const body = await parseBody(c, createCustomerSchema);
    const customer: Customer = {
      id: generateId("customer"),
      organizationId: body.organizationId,
      email: body.email,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.walletAddress !== undefined ? { walletAddress: body.walletAddress } : {}),
      ...(body.githubUsername !== undefined ? { githubUsername: body.githubUsername } : {}),
      ...(body.discordUserId !== undefined ? { discordUserId: body.discordUserId } : {}),
      metadata: body.metadata,
      createdAt: new Date().toISOString(),
    };
    return created(c, await c.get("ctx").customers.save(customer));
  });

  app.get("/", async (c) => data(c, await c.get("ctx").customers.list()));

  app.get("/:id", async (c) => {
    const customer = await c.get("ctx").customers.findById(c.req.param("id"));
    if (!customer) throw notFound("customer not found", { id: c.req.param("id") });
    return data(c, customer);
  });

  return app;
}
