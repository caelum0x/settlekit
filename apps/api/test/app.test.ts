/**
 * End-to-end API tests using Hono's built-in test client (`app.request()`).
 *
 * These hit real routes against real @settlekit services + in-memory repos:
 * product -> price -> customer -> checkout -> payment -> confirm -> entitlement
 * granted, plus coverage across the plan §26 integration surface (GitHub,
 * Discord, SaaS, bundles, delivery, agent services, escrow) and the access/key
 * endpoints (api-keys issue/verify, license verify).
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import { createContext, type AppEnv } from "../src/context.js";

const BOOTSTRAP = "test-bootstrap-key";

async function authedApp(): Promise<Hono<AppEnv>> {
  process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
  return createApp(await createContext());
}

interface Json {
  data?: any;
  error?: { code: string; message: string };
}

async function call(
  app: Hono<AppEnv>,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Json }> {
  const res = await app.request(path, {
    method,
    headers: {
      authorization: `Bearer ${BOOTSTRAP}`,
      "content-type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json()) as Json;
  return { status: res.status, json };
}

describe("SettleKit API", () => {
  let app: Hono<AppEnv>;

  beforeEach(async () => {
    app = await authedApp();
  });

  it("rejects unauthenticated requests with a 401 error envelope", async () => {
    const res = await app.request("/v1/products", { method: "GET" });
    expect(res.status).toBe(401);
    const json = (await res.json()) as Json;
    expect(json.error?.code).toBe("unauthorized");
  });

  it("serves health without auth", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).data.status).toBe("ok");
  });

  it("runs the full purchase->entitlement flow", async () => {
    // 1. Create a product.
    const product = await call(app, "POST", "/v1/products", {
      merchantId: "mch_1",
      organizationId: "org_1",
      name: "Pro Repo Access",
      description: "Private repo",
      type: "github_repo_access",
      deliveryMode: "github_invite",
    });
    expect(product.status).toBe(201);
    const productId = product.json.data.id as string;

    // 2. Create a price.
    const price = await call(app, "POST", `/v1/products/${productId}/prices`, {
      amount: "25.00",
      interval: "one_time",
    });
    expect(price.status).toBe(201);
    const priceId = price.json.data.id as string;

    // 3. Create a customer.
    const customer = await call(app, "POST", "/v1/customers", {
      organizationId: "org_1",
      email: "buyer@example.com",
      githubUsername: "octocat",
    });
    expect(customer.status).toBe(201);
    const customerId = customer.json.data.id as string;

    // 4. Create a checkout session for the product/price.
    const checkout = await call(app, "POST", "/v1/checkout-sessions", {
      organizationId: "org_1",
      merchantId: "mch_1",
      customerId,
      items: [{ priceId, productId, quantity: 1 }],
      payToAddress: "0xMerchantWallet",
      network: "base",
    });
    expect(checkout.status).toBe(201);
    expect(checkout.json.data.amount.amount).toBe("25");
    const sessionId = checkout.json.data.id as string;

    // 5. Record a pending payment.
    const payment = await call(app, "POST", "/v1/payments", {
      checkoutSessionId: sessionId,
    });
    expect(payment.status).toBe(201);
    expect(payment.json.data.status).toBe("pending");
    const paymentId = payment.json.data.id as string;

    // 6. Confirm the payment -> session completed + entitlement granted.
    const confirmed = await call(app, "POST", `/v1/payments/${paymentId}/confirm`, {
      txHash: "0xabc123",
      confirmations: 3,
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.json.data.payment.status).toBe("confirmed");
    expect(confirmed.json.data.entitlements).toHaveLength(1);
    const entitlement = confirmed.json.data.entitlements[0];
    expect(entitlement.productId).toBe(productId);
    expect(entitlement.status).toBe("active");

    // 7. Verify access via the entitlement service.
    const verify = await call(app, "POST", "/v1/entitlements/verify", {
      customerId,
      productId,
    });
    expect(verify.status).toBe(200);
    expect(verify.json.data.allowed).toBe(true);

    // 8. The session is now completed.
    const session = await call(app, "GET", `/v1/checkout-sessions/${sessionId}`);
    expect(session.json.data.status).toBe("completed");
  });

  it("issues and verifies API keys", async () => {
    const issued = await call(app, "POST", "/v1/api-keys", {
      organizationId: "org_1",
      customerId: "cus_1",
      productId: "prod_1",
      entitlementId: "ent_1",
      scopes: ["read", "write"],
      env: "test",
    });
    expect(issued.status).toBe(201);
    const plaintext = issued.json.data.plaintext as string;
    expect(plaintext.startsWith("sk_test_")).toBe(true);

    const verify = await call(app, "POST", "/v1/api-keys/verify", {
      key: plaintext,
      requiredScopes: ["read"],
    });
    expect(verify.json.data.valid).toBe(true);

    const missingScope = await call(app, "POST", "/v1/api-keys/verify", {
      key: plaintext,
      requiredScopes: ["admin"],
    });
    expect(missingScope.json.data.valid).toBe(false);
  });

  it("issues and verifies license keys", async () => {
    const issued = await call(app, "POST", "/v1/license-keys", {
      organizationId: "org_1",
      customerId: "cus_1",
      productId: "prod_1",
      entitlementId: "ent_1",
      machineLimit: 2,
    });
    expect(issued.status).toBe(201);
    const key = issued.json.data.key as string;

    const verify = await call(app, "POST", "/v1/license-keys/verify", {
      licenseKey: key,
      productId: "prod_1",
      machineId: "machine-A",
    });
    expect(verify.status).toBe(200);
    expect(verify.json.data.active).toBe(true);
  });

  it("validates request bodies with a 400 error envelope", async () => {
    const res = await call(app, "POST", "/v1/products", { name: "missing fields" });
    expect(res.status).toBe(400);
    expect(res.json.error?.code).toBe("validation_error");
  });

  it("manages SaaS plans, features, and seats", async () => {
    const plan = await call(app, "POST", "/v1/saas/plans", {
      productId: "prod_saas",
      name: "Team",
      interval: "monthly",
      amount: "49.00",
      features: { sso: true, projects: 25 },
      seats: 5,
    });
    expect(plan.status).toBe(201);
    const planId = plan.json.data.id as string;

    const verify = await call(app, "POST", "/v1/saas/entitlements/verify", {
      planId,
      organizationId: "org_1",
      customerId: "cus_saas",
      grantedById: "sub_1",
      feature: "sso",
    });
    expect(verify.json.data.enabled).toBe(true);

    const seat = await call(app, "POST", "/v1/saas/seats", {
      customerId: "cus_saas",
      userId: "user_1",
      planId,
    });
    expect(seat.status).toBe(201);
    expect(seat.json.data.seats).toHaveLength(1);

    const removed = await call(app, "POST", "/v1/saas/seats/remove", {
      customerId: "cus_saas",
      userId: "user_1",
    });
    expect(removed.json.data.seats).toHaveLength(0);
  });

  it("grants and revokes GitHub repo access through the real domain functions", async () => {
    const grant = await call(app, "POST", "/v1/github/access/grant", {
      organizationId: "org_1",
      installationId: 555,
      customerId: "cus_1",
      entitlementId: "ent_1",
      repoOwner: "acme",
      repoName: "private",
      githubUsername: "octocat",
    });
    expect(grant.status).toBe(201);
    expect(grant.json.data.status).toBe("invited");
    const grantId = grant.json.data.id as string;

    const repos = await call(app, "GET", "/v1/integrations/github/repositories");
    expect(repos.json.data.some((r: any) => r.fullName === "acme/private")).toBe(true);

    const revoke = await call(app, "POST", "/v1/github/access/revoke", { grantId });
    expect(revoke.json.data.status).toBe("revoked");
  });

  it("lists Discord guilds/roles and grants a role", async () => {
    const guilds = await call(app, "GET", "/v1/integrations/discord/guilds");
    expect(guilds.json.data.length).toBeGreaterThan(0);
    const guildId = guilds.json.data[0].id as string;

    const roles = await call(app, "GET", `/v1/integrations/discord/roles?guildId=${guildId}`);
    expect(roles.json.data.length).toBeGreaterThan(0);
    const roleId = roles.json.data[0].id as string;

    const grant = await call(app, "POST", "/v1/discord/access/grant", {
      organizationId: "org_1",
      guildId,
      roleId,
      customerId: "cus_1",
      entitlementId: "ent_1",
      discordUserId: "9999",
    });
    expect(grant.status).toBe(201);
    expect(grant.json.data.status).toBe("active");
  });

  it("creates and publishes a bundle", async () => {
    // Bundles validate that member products exist, so create one first.
    const product = await call(app, "POST", "/v1/products", {
      merchantId: "mch_1",
      organizationId: "org_1",
      name: "Member",
      description: "x",
      type: "digital_download",
      deliveryMode: "file_download",
    });
    const productId = product.json.data.id as string;

    const bundle = await call(app, "POST", "/v1/bundles", {
      merchantId: "mch_1",
      organizationId: "org_1",
      name: "Starter Bundle",
      productIds: [productId],
      amount: "99.00",
    });
    expect(bundle.status).toBe(201);
    const bundleId = bundle.json.data.id as string;

    const published = await call(app, "POST", `/v1/bundles/${bundleId}/publish`);
    expect(published.json.data.status).toBe("active");
  });

  it("tests a delivery action through the registry", async () => {
    const res = await call(app, "POST", "/v1/delivery-actions/test", {
      action: { type: "webhook_send", url: "https://example.com/hook" },
    });
    expect(res.status).toBe(201);
    expect(res.json.data.status).toBe("succeeded");
    expect(res.json.data.output.status).toBe(200);
  });

  it("creates, publishes, and serves metadata for an agent service", async () => {
    const created = await call(app, "POST", "/v1/agent-services", {
      organizationId: "org_1",
      merchantId: "mch_1",
      productId: "prod_agent",
      name: "Summarizer",
      description: "Summarizes text",
      endpoint: "https://api.example.com/summarize",
      price: "0.05",
      network: "base",
      inputSchema: { type: "object", properties: { text: { type: "string" } } },
    });
    expect(created.status).toBe(201);
    const id = created.json.data.id as string;

    const published = await call(app, "POST", `/v1/agent-services/${id}/publish`);
    expect(published.json.data.published).toBe(true);

    const meta = await app.request(`/v1/agent-services/${id}/metadata.json`, {
      headers: { authorization: `Bearer ${BOOTSTRAP}` },
    });
    expect(meta.status).toBe(200);
    const metaJson = (await meta.json()) as Record<string, unknown>;
    expect(metaJson).toBeTruthy();
  });

  it("runs the escrow task lifecycle", async () => {
    const task = await call(app, "POST", "/v1/escrow/tasks", {
      organizationId: "org_1",
      buyerCustomerId: "cus_buyer",
      title: "Build a widget",
      description: "Deliver a widget",
      amount: "100.00",
    });
    expect(task.status).toBe(201);
    const id = task.json.data.id as string;
    expect(task.json.data.status).toBe("created");

    const funded = await call(app, "POST", `/v1/escrow/tasks/${id}/fund`, {
      fundingTxHash: "0xfund",
    });
    expect(funded.json.data.status).toBe("funded");

    const assigned = await call(app, "POST", `/v1/escrow/tasks/${id}/assign`, {
      workerCustomerId: "cus_worker",
    });
    expect(assigned.json.data.status).toBe("assigned");

    const submitted = await call(app, "POST", `/v1/escrow/tasks/${id}/submit`, {
      content: "done",
    });
    expect(submitted.json.data.status).toBe("submitted");

    const approved = await call(app, "POST", `/v1/escrow/tasks/${id}/approve`);
    expect(approved.json.data.status).toBe("approved");
  });

  it("registers a webhook endpoint and emits a signed event", async () => {
    const endpoint = await call(app, "POST", "/v1/webhooks/endpoints", {
      organizationId: "org_1",
      url: "https://example.com/webhook",
      enabledEvents: ["payment.confirmed"],
    });
    expect(endpoint.status).toBe(201);

    const event = await call(app, "POST", "/v1/webhooks/events", {
      organizationId: "org_1",
      type: "payment.confirmed",
      data: { paymentId: "pay_1" },
    });
    expect(event.status).toBe(201);
    expect(event.json.data.deliveries).toHaveLength(1);
    expect(event.json.data.deliveries[0].signature).toContain("v1=");
  });
});
