/**
 * Webhook event log: per-attempt delivery records, resend, test events,
 * secret rotation with a grace window, and enable/disable. No database, so
 * deliveries run in-process against a stubbed fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import { verifySignature } from "@settlekit/webhooks";
import { createApp } from "../src/app.js";
import { createContext, type AppContext, type AppEnv } from "../src/context.js";

const BOOTSTRAP = "test-bootstrap-key";
let app: Hono<AppEnv>;
let ctx: AppContext;
let otherKey: string;
const received: { url: string; body: string; signature: string }[] = [];
let respondWith = 200;

async function call(method: string, path: string, body?: unknown, key = BOOTSTRAP) {
  const res = await app.request(path, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as { data?: any; error?: { message: string } } };
}

beforeEach(async () => {
  process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
  received.length = 0;
  respondWith = 200;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    received.push({ url, body: String(init.body), signature: headers["SettleKit-Signature"] ?? "" });
    return new Response("", { status: respondWith });
  });
  ctx = await createContext();
  app = createApp(ctx);
  otherKey = (
    await ctx.apiKeys.issue({ organizationId: "org_other", customerId: "c", productId: "p", entitlementId: "e", scopes: ["*"], env: "live" })
  ).plaintext;
});

afterEach(() => vi.unstubAllGlobals());

async function endpoint(events = ["payment.confirmed"]) {
  const res = await call("POST", "/v1/webhooks/endpoints", { url: "https://hooks.test/settlekit", enabledEvents: events });
  expect(res.status).toBe(201);
  return res.json.data as { id: string; signingSecret: string };
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

describe("webhook event log", () => {
  it("sends a signed test event and logs the attempt", async () => {
    const ep = await endpoint();
    const test = await call("POST", `/v1/webhooks/endpoints/${ep.id}/test`);
    expect(test.status).toBe(201);
    expect(test.json.data).toMatchObject({ eventType: "webhook.test", status: "delivered", attempts: 1, lastStatus: 200, manual: "test" });
    expect(received).toHaveLength(1);
    expect(verifySignature(ep.signingSecret, received[0]!.body, received[0]!.signature, 300)).toBe(true);
    const log = await call("GET", `/v1/webhooks/deliveries?endpointId=${ep.id}`);
    expect(log.json.data).toHaveLength(1);
    expect(JSON.stringify(log.json.data)).not.toContain(ep.signingSecret);
  });

  it("records failures with status codes and resends an event", async () => {
    const ep = await endpoint();
    respondWith = 500;
    const failed = await call("POST", `/v1/webhooks/endpoints/${ep.id}/test`);
    expect(failed.json.data).toMatchObject({ status: "failed", lastStatus: 500, lastError: "HTTP 500" });
    expect(failed.json.data.nextAttemptAt).toBeTruthy();

    // A real event emitted by the outbox lands in the log too.
    await ctx.webhookOutbox.enqueue({ organizationId: "org_settlekit_default", type: "payment.confirmed", key: "pay_1", data: { paymentId: "pay_1" } });
    await settle();
    const events = await call("GET", "/v1/webhooks/deliveries");
    const eventId = events.json.data.find((d: { eventType: string }) => d.eventType === "payment.confirmed").eventId;

    respondWith = 200;
    const resent = await call("POST", `/v1/webhooks/events/${eventId}/resend`, {});
    expect(resent.status).toBe(201);
    expect(resent.json.data).toHaveLength(1);
    expect(resent.json.data[0]).toMatchObject({ status: "delivered", manual: "resend", eventId });
    const single = await call("GET", `/v1/webhooks/deliveries/${resent.json.data[0].id}`);
    expect(single.json.data.history).toHaveLength(1);
  });

  it("rotates the secret with a grace window so both secrets verify", async () => {
    const ep = await endpoint();
    const rotated = await call("POST", `/v1/webhooks/endpoints/${ep.id}/rotate-secret`, { graceHours: 24 });
    expect(rotated.status).toBe(200);
    const next = rotated.json.data.signingSecret as string;
    expect(next).not.toBe(ep.signingSecret);
    expect(rotated.json.data.previousSigningSecret).toBeUndefined();
    await call("POST", `/v1/webhooks/endpoints/${ep.id}/test`);
    const { body, signature } = received.at(-1)!;
    expect(verifySignature(next, body, signature, 300)).toBe(true);
    expect(verifySignature(ep.signingSecret, body, signature, 300)).toBe(true);

    await call("POST", `/v1/webhooks/endpoints/${ep.id}/rotate-secret`, { graceHours: 0 });
    await call("POST", `/v1/webhooks/endpoints/${ep.id}/test`);
    const last = received.at(-1)!;
    expect(verifySignature(next, last.body, last.signature, 300)).toBe(false);
    expect((await call("POST", `/v1/webhooks/endpoints/${ep.id}/rotate-secret`, { graceHours: 500 })).status).toBe(400);
  });

  it("disables and re-enables an endpoint and keeps other tenants out", async () => {
    const ep = await endpoint();
    const off = await call("POST", `/v1/webhooks/endpoints/${ep.id}/disable`);
    expect(off.json.data).toMatchObject({ active: false, disabledReason: "disabled by the merchant" });
    expect(off.json.data.signingSecret).toBeUndefined();
    await ctx.webhookOutbox.enqueue({ organizationId: "org_settlekit_default", type: "payment.confirmed", key: "pay_2", data: {} });
    await settle();
    expect(received).toHaveLength(0);
    const on = await call("POST", `/v1/webhooks/endpoints/${ep.id}/enable`);
    expect(on.json.data).toMatchObject({ active: true, consecutiveFailures: 0 });

    expect((await call("POST", `/v1/webhooks/endpoints/${ep.id}/test`, undefined, otherKey)).status).toBe(404);
    expect((await call("GET", "/v1/webhooks/deliveries", undefined, otherKey)).json.data).toHaveLength(0);
  });
});
