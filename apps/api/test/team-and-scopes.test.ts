/**
 * Team roles and API key scopes: buyer access keys can never act as the
 * merchant, restricted platform keys only reach their scopes, keys cannot
 * mint broader keys, and invited teammates get their role's permissions.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import { createContext, type AppContext, type AppEnv } from "../src/context.js";

const BOOTSTRAP = "test-bootstrap-key";
let app: Hono<AppEnv>;
let ctx: AppContext;

async function call(method: string, path: string, body?: unknown, key: string | null = BOOTSTRAP) {
  const res = await app.request(path, {
    method,
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as { data?: any; error?: { code: string; message: string; details?: any } } };
}

beforeEach(async () => {
  process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
  ctx = { ...(await createContext()), email: null };
  app = createApp(ctx);
});

describe("API key scopes", () => {
  it("refuses buyer access keys on the management API, whatever their scopes", async () => {
    for (const scopes of [["read"], ["*"], ["payments:read"]]) {
      const buyerKey = await ctx.apiKeys.issue({
        organizationId: "org_settlekit_default",
        customerId: "cus_buyer",
        productId: "prod_api_access",
        entitlementId: "ent_1",
        scopes,
        env: "live",
      });
      const res = await call("GET", "/v1/payments", undefined, buyerKey.plaintext);
      expect(res.status).toBe(403);
      expect(res.json.error?.message).toMatch(/customer access key/);
    }
  });

  it("limits a restricted platform key to its scopes", async () => {
    const issued = await call("POST", "/v1/api-keys/platform", { scopes: ["payments:read", "access:read"], label: "reporting" });
    expect(issued.status).toBe(201);
    expect(issued.json.data.apiKey.kind).toBe("platform");
    const key = issued.json.data.plaintext as string;
    expect((await call("GET", "/v1/payments", undefined, key)).status).toBe(200);
    const denied = await call("POST", "/v1/products", { merchantId: "m", name: "x", type: "license_key", deliveryMode: "license_key" }, key);
    expect(denied.status).toBe(403);
    expect(denied.json.error?.details?.requiredScope).toBe("products:write");
    expect((await call("POST", "/v1/entitlements/verify", { customerId: "c", productId: "p" }, key)).status).toBe(200);
    expect((await call("GET", "/v1/exports/payments.csv", undefined, key)).status).toBe(403);
  });

  it("cannot mint a key broader than itself and customer keys cannot carry management scopes", async () => {
    const limited = (await call("POST", "/v1/api-keys/platform", { scopes: ["api_keys:write"] })).json.data.plaintext as string;
    const escalate = await call("POST", "/v1/api-keys/platform", { scopes: ["platform:admin"] }, limited);
    expect(escalate.status).toBe(403);
    expect((await call("POST", "/v1/api-keys/platform", { scopes: ["payments:read"] }, limited)).status).toBe(403);
    expect((await call("POST", "/v1/api-keys/platform", { scopes: ["api_keys:read"] }, limited)).status).toBe(201);

    const customerStar = await call("POST", "/v1/api-keys", { customerId: "c", productId: "p", entitlementId: "e", scopes: ["*"] });
    expect(customerStar.status).toBe(400);
  });

  it("lists and revokes only the organization's keys", async () => {
    const other = await ctx.apiKeys.issue({ organizationId: "org_other", customerId: "x", productId: "__platform__", entitlementId: "__platform__", scopes: ["*"], env: "live" });
    const mine = await call("POST", "/v1/api-keys/platform", { scopes: ["reports:read"] });
    const list = await call("GET", "/v1/api-keys");
    expect(list.json.data.map((k: { id: string }) => k.id)).toContain(mine.json.data.apiKey.id);
    expect(list.json.data.map((k: { id: string }) => k.id)).not.toContain(other.apiKey.id);
    expect((await call("POST", `/v1/api-keys/${other.apiKey.id}/revoke`)).status).toBe(404);
    const revoked = await call("POST", `/v1/api-keys/${mine.json.data.apiKey.id}/revoke`);
    expect(revoked.json.data.status).toBe("revoked");
    expect((await call("GET", "/v1/payments", undefined, mine.json.data.plaintext)).status).toBe(401);
  });
});

describe("team roles", () => {
  async function registerOwner(): Promise<string> {
    const res = await call("POST", "/v1/auth/register", { type: "merchant", email: "owner@acme.test", password: "correct horse 1" }, null);
    expect(res.status).toBe(201);
    return res.json.data.sessionToken as string;
  }

  async function invite(owner: string, email: string, role: string): Promise<string> {
    const res = await call("POST", "/v1/team/invitations", { email, role }, owner);
    expect(res.status).toBe(201);
    expect(res.json.data.invitation.tokenHash).toBeUndefined();
    return (res.json.data.inviteUrl as string).split("/invite/")[1]!;
  }

  it("invites a developer who gets exactly the developer permissions", async () => {
    const owner = await registerOwner();
    const token = decodeURIComponent(await invite(owner, "dev@acme.test", "developer"));
    const team = await call("GET", "/v1/team", undefined, owner);
    expect(team.json.data.members).toEqual([expect.objectContaining({ email: "owner@acme.test", role: "owner" })]);
    expect(team.json.data.invitations).toEqual([expect.objectContaining({ email: "dev@acme.test", role: "developer", status: "pending" })]);

    expect((await call("POST", "/v1/auth/invitations/accept", { token }, null)).status).toBe(400);
    const accepted = await call("POST", "/v1/auth/invitations/accept", { token, password: "dev password 1" }, null);
    expect(accepted.status).toBe(200);
    const dev = accepted.json.data.sessionToken as string;
    expect(accepted.json.data.account.organizationId).toBe(team.json.data.members[0] ? (await call("GET", "/v1/auth/session", undefined, owner)).json.data.account.organizationId : "");
    // Token is single use.
    expect((await call("POST", "/v1/auth/invitations/accept", { token, password: "again password" }, null)).status).toBe(404);

    expect((await call("GET", "/v1/payments", undefined, dev)).status).toBe(200);
    expect((await call("POST", "/v1/merchant/products", { name: "X", priceUsd: "5", delivery: { kind: "license_key", machineLimit: 1 } }, dev)).status).not.toBe(403);
    const settings = await call("POST", "/v1/settings", { orgName: "Hijack" }, dev);
    expect(settings.status).toBe(403);
    expect((await call("POST", "/v1/team/invitations", { email: "x@acme.test", role: "viewer" }, dev)).status).toBe(403);
  });

  it("protects the owner role and removes members", async () => {
    const owner = await registerOwner();
    const token = decodeURIComponent(await invite(owner, "admin@acme.test", "admin"));
    const admin = (await call("POST", "/v1/auth/invitations/accept", { token, password: "admin password" }, null)).json.data.sessionToken as string;
    // An admin cannot mint owners.
    expect((await call("POST", "/v1/team/invitations", { email: "o2@acme.test", role: "owner" }, admin)).status).toBe(403);

    const members = (await call("GET", "/v1/team", undefined, owner)).json.data.members as { accountId: string; role: string }[];
    const ownerId = members.find((m) => m.role === "owner")!.accountId;
    const adminId = members.find((m) => m.role === "admin")!.accountId;
    expect((await call("PATCH", `/v1/team/members/${ownerId}`, { role: "viewer" }, owner)).status).toBe(400);
    expect((await call("PATCH", `/v1/team/members/${adminId}`, { role: "viewer" }, owner)).json.data.role).toBe("viewer");
    // Viewer now: reads only.
    expect((await call("GET", "/v1/payments", undefined, admin)).status).toBe(200);
    expect((await call("POST", "/v1/coupons", { code: "X", discount: { type: "percent", percentOff: 5 } }, admin)).status).toBe(403);

    expect((await call("DELETE", `/v1/team/members/${adminId}`, undefined, owner)).status).toBe(200);
    expect((await call("GET", "/v1/payments", undefined, admin)).status).toBe(401);
  });

  it("revokes invitations", async () => {
    const owner = await registerOwner();
    const token = decodeURIComponent(await invite(owner, "late@acme.test", "viewer"));
    const inv = (await call("GET", "/v1/team", undefined, owner)).json.data.invitations[0];
    expect((await call("POST", `/v1/team/invitations/${inv.id}/revoke`, undefined, owner)).json.data.status).toBe("revoked");
    expect((await call("POST", "/v1/auth/invitations/accept", { token, password: "late password" }, null)).status).toBe(404);
  });
});
