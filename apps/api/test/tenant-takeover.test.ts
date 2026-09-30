/**
 * Registration can never join an existing merchant organization: a merchant
 * always gets a fresh org, and a customer account (portal buyers, who do
 * carry the seller's org id) never gets management access through its
 * session.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import { createContext, type AppContext, type AppEnv } from "../src/context.js";

let app: Hono<AppEnv>;
let ctx: AppContext;

async function call(method: string, path: string, body?: unknown, key: string | null = null) {
  const res = await app.request(path, {
    method,
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as { data?: any; error?: { code: string; message: string } } };
}

beforeEach(async () => {
  delete process.env.API_BOOTSTRAP_KEY;
  ctx = { ...(await createContext()), email: null };
  app = createApp(ctx);
});

describe("registration tenant boundary", () => {
  async function victim(): Promise<{ org: string; key: string }> {
    const res = await call("POST", "/v1/auth/register", { type: "merchant", email: "victim@shop.test", password: "victim password 1" });
    expect(res.status).toBe(201);
    return { org: res.json.data.account.organizationId as string, key: res.json.data.apiKey as string };
  }

  it("gives a merchant who names another org its own fresh org and key", async () => {
    const v = await victim();
    const product = await call("POST", "/v1/merchant/products", {
      name: "Secret",
      priceUsd: "10",
      delivery: { kind: "access", accessUrl: "https://example.com/x" },
    }, v.key);
    expect(product.status).toBe(201);

    const attacker = await call("POST", "/v1/auth/register", {
      type: "merchant",
      email: "attacker@evil.test",
      password: "attacker password 1",
      organizationId: v.org,
    });
    expect(attacker.status).toBe(201);
    expect(attacker.json.data.account.organizationId).not.toBe(v.org);
    const listed = await call("GET", "/v1/merchant/products", undefined, attacker.json.data.apiKey);
    expect(listed.status).toBe(200);
    expect(listed.json.data).toEqual([]);
    const viaSession = await call("GET", "/v1/merchant/products", undefined, attacker.json.data.sessionToken);
    expect(viaSession.json.data).toEqual([]);
  });

  it("refuses the management API to customer sessions that carry the seller's org", async () => {
    const v = await victim();
    const buyer = await call("POST", "/v1/auth/register", {
      type: "customer",
      email: "buyer@mail.test",
      password: "buyer password 1",
      organizationId: v.org,
    });
    expect(buyer.status).toBe(201);
    expect(buyer.json.data.apiKey).toBeUndefined();
    const token = buyer.json.data.sessionToken as string;
    // The session itself still works for the customer portal.
    expect((await call("GET", "/v1/auth/session", undefined, token)).status).toBe(200);
    for (const [method, path] of [
      ["GET", "/v1/payments"],
      ["GET", "/v1/merchant/products"],
      ["GET", "/v1/api-keys"],
      ["POST", "/v1/api-keys/platform"],
    ] as const) {
      const res = await call(method, path, method === "POST" ? { scopes: ["platform:admin"] } : undefined, token);
      expect(res.status, `${method} ${path}`).toBeGreaterThanOrEqual(401);
      expect(res.status, `${method} ${path}`).toBeLessThanOrEqual(403);
    }
  });
});
