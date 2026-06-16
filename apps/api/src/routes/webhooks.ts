/**
 * Webhook routes (plan §18).
 *
 * Manage webhook endpoints (url + signing secret + enabled events) and emit
 * events. Events are built with the real `@settlekit/webhooks` `buildWebhookEvent`
 * and persisted; the signed payload header is computed with `signPayload` so a
 * caller can see exactly what a receiver would verify.
 */
import { Hono } from "hono";
import { z } from "zod";
import { generateId, generateSecret, notFound, type WebhookEndpoint } from "@settlekit/common";
import { buildWebhookEvent, signPayload, serializeEvent } from "@settlekit/webhooks";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { requireOrg } from "../http/tenant.js";

const EVENT_TYPES = [
  "payment.confirmed",
  "payment.failed",
  "payment.refunded",
  "subscription.created",
  "subscription.renewed",
  "subscription.canceled",
  "entitlement.granted",
  "entitlement.revoked",
  "delivery.succeeded",
  "delivery.failed",
] as const;

const createEndpointSchema = z.object({
  // Derived from the authenticated org (tenant scope); ignored if supplied.
  organizationId: z.string().min(1).optional(),
  url: z.string().url(),
  enabledEvents: z.array(z.enum(EVENT_TYPES)).min(1),
});

const emitSchema = z.object({
  // Derived from the authenticated org (tenant scope); ignored if supplied.
  organizationId: z.string().min(1).optional(),
  type: z.enum(EVENT_TYPES),
  data: z.record(z.unknown()).default({}),
});

export function webhookRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // List endpoints at the resource root (alias of GET /endpoints).
  app.get("/", async (c) => {
    // Tenant-scoped: only the authenticated organization's endpoints.
    const orgId = requireOrg(c);
    const list = await c.get("ctx").webhookEndpoints.list((e) => e.organizationId === orgId);
    return data(c, list);
  });

  // Register a webhook endpoint with a freshly-minted signing secret.
  app.post("/endpoints", async (c) => {
    const body = await parseBody(c, createEndpointSchema);
    const endpoint: WebhookEndpoint = {
      id: generateId("webhookEndpoint"),
      organizationId: requireOrg(c),
      url: body.url,
      signingSecret: generateSecret(),
      enabledEvents: body.enabledEvents,
      active: true,
      createdAt: new Date().toISOString(),
    };
    return created(c, await c.get("ctx").webhookEndpoints.save(endpoint));
  });

  app.get("/endpoints", async (c) => {
    // Tenant-scoped: only the authenticated organization's endpoints.
    const orgId = requireOrg(c);
    const list = await c.get("ctx").webhookEndpoints.list((e) => e.organizationId === orgId);
    return data(c, list);
  });

  // Emit an event: persist it and return the signed payload for each matching endpoint.
  app.post("/events", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, emitSchema);
    // Tenant-scoped: the event belongs to the authenticated org.
    const organizationId = requireOrg(c);
    const event = buildWebhookEvent(body.type, body.data, {
      organizationId,
    });
    const saved = await ctx.webhookEvents.save(event);

    const payloadJson = serializeEvent(saved);
    const timestamp = Math.floor(Date.now() / 1000);
    const deliveries = (
      await ctx.webhookEndpoints.list(
        (e) =>
          e.organizationId === organizationId &&
          e.active &&
          e.enabledEvents.includes(body.type),
      )
    )
      .map((endpoint) => ({
        endpointId: endpoint.id,
        url: endpoint.url,
        signature: signPayload(endpoint.signingSecret, payloadJson, timestamp),
      }));

    return created(c, { event: saved, deliveries });
  });

  app.get("/events", async (c) => {
    // Tenant-scoped: only the authenticated organization's events.
    const orgId = requireOrg(c);
    const list = await c.get("ctx").webhookEvents.list((e) => e.organizationId === orgId);
    return data(c, list);
  });

  app.get("/events/:id", async (c) => {
    const event = await c.get("ctx").webhookEvents.findById(c.req.param("id"));
    if (!event) throw notFound("webhook event not found", { id: c.req.param("id") });
    return data(c, event);
  });

  return app;
}
