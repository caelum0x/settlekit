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
import {
  deliveryView,
  enableEndpoint,
  rotateEndpointSecret,
  subscribedEndpoints,
} from "@settlekit/persistence";
import type { Context } from "hono";
import { queueManualDelivery } from "../webhooks/outbox.js";
import { buildWebhookEvent, signPayload, serializeEvent } from "@settlekit/webhooks";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody, validate } from "../http/validate.js";
import { requireOrg, requireOwned } from "../http/tenant.js";

const EVENT_TYPES = [
  "payment.confirmed",
  "payment.failed",
  "payment.refunded",
  "refund.succeeded",
  "subscription.created",
  "subscription.charged",
  "subscription.renewed",
  "subscription.canceled",
  "entitlement.granted",
  "entitlement.revoked",
  "delivery.succeeded",
  "delivery.failed",
  "invoice.paid",
  "webhook.test",
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

const resendSchema = z.object({
  /** Only this endpoint; default: every active endpoint subscribed to the event. */
  endpointId: z.string().min(1).optional(),
});

const rotateSchema = z.object({
  /** How long the previous secret keeps signing deliveries (0-168 hours). */
  graceHours: z.number().int().min(0).max(168).default(24),
});

/** Load an endpoint of the caller's org (404 otherwise). */
async function ownedEndpoint(c: Context<AppEnv>, id: string): Promise<WebhookEndpoint> {
  return requireOwned(c, await c.get("ctx").webhookEndpoints.findById(id), "webhook endpoint", id);
}

/** Endpoint without secrets, for listings that do not need them. */
function publicEndpoint(endpoint: WebhookEndpoint) {
  const { signingSecret: _s, previousSigningSecret: _p, ...rest } = endpoint;
  void _s;
  void _p;
  return rest;
}

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
    const id = c.req.param("id");
    return data(c, requireOwned(c, await c.get("ctx").webhookEvents.findById(id), "webhook event", id));
  });

  // Delivery log: one row per (event, endpoint) with every attempt.
  app.get("/deliveries", async (c) => {
    const ctx = c.get("ctx");
    const eventId = c.req.query("eventId");
    const endpointId = c.req.query("endpointId");
    const status = c.req.query("status");
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 100) || 100, 1), 500);
    const jobs = (await ctx.webhookJobs.listByOrganization(requireOrg(c), 1_000))
      .filter((j) => (eventId ? j.event.id === eventId : true))
      .filter((j) => (endpointId ? j.endpoint.id === endpointId : true))
      .filter((j) => (status ? j.status === status : true))
      .slice(0, limit);
    return data(c, jobs.map(deliveryView));
  });

  app.get("/deliveries/:id", async (c) => {
    const id = c.req.param("id");
    const job = await c.get("ctx").webhookJobs.findById(id);
    if (!job || job.event.organizationId !== requireOrg(c)) throw notFound("webhook delivery not found", { id });
    return data(c, deliveryView(job));
  });

  // Resend an event (fresh delivery with a new signature and attempt log).
  app.post("/events/:id/resend", async (c) => {
    const ctx = c.get("ctx");
    const id = c.req.param("id");
    const event = requireOwned(c, await ctx.webhookEvents.findById(id), "webhook event", id);
    const raw = await c.req.json().catch(() => ({}));
    const body = validate(resendSchema, raw);
    const endpoints = body.endpointId
      ? [await ownedEndpoint(c, body.endpointId)]
      : subscribedEndpoints(await ctx.webhookEndpoints.list(), event.organizationId, event.type);
    const jobs = [];
    for (const endpoint of endpoints) {
      jobs.push(await queueManualDelivery(ctx.db, ctx.webhookJobs, event, endpoint, "resend"));
    }
    return created(c, jobs.map(deliveryView));
  });

  // Send a signed webhook.test event to one endpoint (ignores enabledEvents).
  app.post("/endpoints/:id/test", async (c) => {
    const ctx = c.get("ctx");
    const endpoint = await ownedEndpoint(c, c.req.param("id"));
    const event = await ctx.webhookEvents.save(
      buildWebhookEvent("webhook.test", { endpointId: endpoint.id, message: "Test event from SettleKit" }, {
        organizationId: endpoint.organizationId,
      }),
    );
    const job = await queueManualDelivery(ctx.db, ctx.webhookJobs, event, endpoint, "test");
    return created(c, deliveryView(job));
  });

  // Rotate the signing secret; the old one keeps signing during the grace window.
  app.post("/endpoints/:id/rotate-secret", async (c) => {
    const ctx = c.get("ctx");
    const endpoint = await ownedEndpoint(c, c.req.param("id"));
    const raw = await c.req.json().catch(() => ({}));
    const body = validate(rotateSchema, raw);
    const rotated = await ctx.webhookEndpoints.save(rotateEndpointSecret(endpoint, new Date(), body.graceHours * 3_600_000));
    return data(c, {
      ...publicEndpoint(rotated),
      signingSecret: rotated.signingSecret,
      previousSecretExpiresAt: rotated.previousSecretExpiresAt ?? null,
    });
  });

  app.post("/endpoints/:id/disable", async (c) => {
    const ctx = c.get("ctx");
    const endpoint = await ownedEndpoint(c, c.req.param("id"));
    const saved = await ctx.webhookEndpoints.save({
      ...endpoint,
      active: false,
      disabledAt: new Date().toISOString(),
      disabledReason: "disabled by the merchant",
    });
    return data(c, publicEndpoint(saved));
  });

  app.post("/endpoints/:id/enable", async (c) => {
    const ctx = c.get("ctx");
    const endpoint = await ownedEndpoint(c, c.req.param("id"));
    return data(c, publicEndpoint(await ctx.webhookEndpoints.save(enableEndpoint(endpoint))));
  });

  return app;
}
