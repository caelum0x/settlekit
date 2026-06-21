/**
 * Agent identity registry routes (`/v1/agents`) — an off-chain, org-scoped
 * mirror of ERC-8004 agent identity + reputation. Register an agent, list/get,
 * and record reputation feedback. Settled on-chain state remains authoritative;
 * this is the queryable record.
 */
import { Hono } from "hono";
import { z } from "zod";
import { SettleKitError } from "@settlekit/common";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { requireOrg } from "../http/tenant.js";

const registerSchema = z.object({
  owner: z.string().min(1),
  metadataUri: z.string().min(1),
  displayName: z.string().min(1).max(120).optional(),
});

const feedbackSchema = z.object({
  score: z.number().int().min(0).max(100),
});

function notFound(message: string): SettleKitError {
  return new SettleKitError({ code: "not_found", message });
}

export function agentRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // POST /v1/agents -> register a new agent identity.
  app.post("/", async (c) => {
    const body = await parseBody(c, registerSchema);
    const agent = await c.get("ctx").agentRegistry.createAgent({
      organizationId: requireOrg(c),
      owner: body.owner,
      metadataUri: body.metadataUri,
      ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
    });
    return created(c, agent);
  });

  // GET /v1/agents -> list the org's agents.
  app.get("/", async (c) => {
    const agents = await c.get("ctx").agentRegistry.listAgents(requireOrg(c));
    return data(c, agents);
  });

  // GET /v1/agents/:id -> fetch one agent.
  app.get("/:id", async (c) => {
    const agent = await c.get("ctx").agentRegistry.getAgent(requireOrg(c), c.req.param("id"));
    if (!agent) throw notFound("Agent not found");
    return data(c, agent);
  });

  // POST /v1/agents/:id/feedback -> record a reputation score (0–100).
  app.post("/:id/feedback", async (c) => {
    const body = await parseBody(c, feedbackSchema);
    const agent = await c
      .get("ctx")
      .agentRegistry.recordFeedback(requireOrg(c), c.req.param("id"), body.score);
    if (!agent) throw notFound("Agent not found");
    return data(c, agent);
  });

  return app;
}
