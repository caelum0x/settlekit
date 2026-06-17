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

/**
 * Drive product -> price -> customer -> checkout -> payment -> confirm and
 * return the confirmed `paymentId` + `customerId`. Used by refund/dispute tests
 * that operate on a real settled payment.
 */
async function makeConfirmedPayment(
  app: Hono<AppEnv>,
): Promise<{ paymentId: string; customerId: string }> {
  const product = await call(app, "POST", "/v1/products", {
    merchantId: "mch_1",
    organizationId: "org_1",
    name: "Refundable Widget",
    description: "A refundable digital download",
    type: "digital_download",
    deliveryMode: "file_download",
  });
  const productId = product.json.data.id as string;
  const price = await call(app, "POST", `/v1/products/${productId}/prices`, {
    amount: "40.00",
    interval: "one_time",
  });
  const priceId = price.json.data.id as string;
  const customer = await call(app, "POST", "/v1/customers", {
    organizationId: "org_1",
    email: "refund-buyer@example.com",
  });
  const customerId = customer.json.data.id as string;
  const checkout = await call(app, "POST", "/v1/checkout-sessions", {
    organizationId: "org_1",
    merchantId: "mch_1",
    customerId,
    items: [{ priceId, productId, quantity: 1 }],
    payToAddress: "0xMerchantWallet",
    network: "base",
  });
  const sessionId = checkout.json.data.id as string;
  const payment = await call(app, "POST", "/v1/payments", {
    checkoutSessionId: sessionId,
  });
  const paymentId = payment.json.data.id as string;
  await call(app, "POST", `/v1/payments/${paymentId}/confirm`, {
    txHash: "0xdeadbeef",
    confirmations: 3,
  });
  return { paymentId, customerId };
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

  // A license key issued through the delivery engine must be persisted in the
  // SAME store the verify route reads — i.e. immediately verifiable.
  it("issues a license key via delivery and verifies it through the API", async () => {
    const issued = await call(app, "POST", "/v1/delivery-actions/test", {
      productId: "prod_delivery",
      action: { type: "license_key_create", policyId: "policy_default" },
    });
    expect(issued.status).toBe(201);
    expect(issued.json.data.status).toBe("succeeded");
    const key = issued.json.data.output.key as string;
    expect(key).toBeTruthy();

    const verify = await call(app, "POST", "/v1/license-keys/verify", {
      licenseKey: key,
      productId: "prod_delivery",
      machineId: "machine-1",
    });
    expect(verify.status).toBe(200);
    expect(verify.json.data.active).toBe(true);
  });

  // An API key issued through delivery must likewise be verifiable via the API.
  it("issues an API key via delivery and verifies it through the API", async () => {
    const issued = await call(app, "POST", "/v1/delivery-actions/test", {
      action: { type: "api_key_create", scopes: ["read", "write"] },
    });
    expect(issued.status).toBe(201);
    const plaintext = issued.json.data.output.plaintext as string;
    expect(plaintext).toBeTruthy();

    const verify = await call(app, "POST", "/v1/api-keys/verify", {
      key: plaintext,
      requiredScopes: ["read"],
    });
    expect(verify.status).toBe(200);
    expect(verify.json.data.valid).toBe(true);
  });

  // Full auth flow exercises every AuthStore entity: account, password
  // credential, session, and single-use magic link.
  it("registers, authenticates a session, logs in, and consumes a magic link once", async () => {
    const reg = await call(app, "POST", "/v1/auth/register", {
      email: "Founder@Example.com",
      password: "correct horse battery staple",
      type: "merchant",
    });
    expect(reg.status).toBe(201);
    const sessionToken = reg.json.data.sessionToken as string;
    expect(sessionToken).toBeTruthy();

    // GET /session with the session token (not the bootstrap key).
    const sessionRes = await app.request("/v1/auth/session", {
      method: "GET",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(sessionRes.status).toBe(200);
    const sessionJson = (await sessionRes.json()) as Json;
    // Email lookup is case-insensitive.
    expect(sessionJson.data.account.email.toLowerCase()).toBe("founder@example.com");

    // Login with the same credentials returns a fresh session.
    const login = await call(app, "POST", "/v1/auth/login", {
      email: "founder@example.com",
      password: "correct horse battery staple",
    });
    expect(login.status).toBe(200);
    expect(login.json.data.sessionToken).toBeTruthy();

    // Magic link: request returns a dev token (no email transport in tests).
    const requested = await call(app, "POST", "/v1/auth/magic-link/request", {
      email: "founder@example.com",
    });
    expect(requested.json.data.ok).toBe(true);
    const devToken = requested.json.data.devToken as string;
    expect(devToken).toBeTruthy();

    // First consume succeeds; the second must fail (single-use).
    const firstUse = await call(app, "POST", "/v1/auth/magic-link/complete", { token: devToken });
    expect(firstUse.status).toBe(200);
    expect(firstUse.json.data.sessionToken).toBeTruthy();

    const secondUse = await call(app, "POST", "/v1/auth/magic-link/complete", { token: devToken });
    expect(secondUse.status).toBeGreaterThanOrEqual(400);
  });

  it("creates, publishes, and discovers a marketplace listing", async () => {
    const created = await call(app, "POST", "/v1/marketplace/listings", {
      organizationId: "org_1",
      merchantId: "mch_1",
      productId: "prod_repo",
      title: "AI SaaS Boilerplate",
      summary: "Production-ready Next.js + USDC billing starter",
      tags: ["nextjs", "saas", "usdc"],
    });
    expect(created.status).toBe(201);
    expect(created.json.data.published).toBe(false);
    const id = created.json.data.id as string;

    // Unpublished listings are not discoverable.
    const before = await call(app, "GET", "/v1/marketplace/listings");
    expect(before.json.data.find((l: { id: string }) => l.id === id)).toBeUndefined();

    const published = await call(app, "POST", `/v1/marketplace/listings/${id}/publish`);
    expect(published.json.data.published).toBe(true);

    // Now discoverable by tag.
    const byTag = await call(app, "GET", "/v1/marketplace/listings?tag=saas");
    expect(byTag.json.data.find((l: { id: string }) => l.id === id)).toBeDefined();

    const rated = await call(app, "POST", `/v1/marketplace/listings/${id}/rate`, { stars: 5 });
    expect(rated.json.data.ratingCount).toBe(1);
    expect(rated.json.data.ratingAverage).toBe(5);

    const seller = await call(app, "GET", "/v1/marketplace/sellers/mch_1");
    expect(seller.json.data.totalListings).toBeGreaterThanOrEqual(1);
    expect(seller.json.data.publishedListings).toBeGreaterThanOrEqual(1);
  });

  // ---- Commerce engines (plan §6/§13/§31): create -> query -> transition ----

  it("creates a coupon and redeems it, decrementing remaining redemptions", async () => {
    const created = await call(app, "POST", "/v1/coupons", {
      code: "LAUNCH20",
      name: "Launch 20% off",
      discount: { type: "percent", percentOff: 20 },
      maxRedemptions: 2,
    });
    expect(created.status).toBe(201);
    expect(created.json.data.code).toBe("LAUNCH20");

    const validated = await call(app, "POST", "/v1/coupons/LAUNCH20/validate", {
      subtotal: "100",
    });
    expect(validated.json.data.ok).toBe(true);
    expect(validated.json.data.discount.amount).toBe("20");
    expect(validated.json.data.total.amount).toBe("80");

    const redeemed = await call(app, "POST", "/v1/coupons/LAUNCH20/redeem", {
      subtotal: "100",
      customerId: "cus_coupon",
    });
    expect(redeemed.status).toBe(200);

    const fetched = await call(app, "GET", "/v1/coupons/LAUNCH20");
    expect(fetched.json.data.redeemedCount).toBe(1);
  });

  it("creates, finalizes, and pays an invoice", async () => {
    const created = await call(app, "POST", "/v1/invoices", {
      organizationId: "org_1",
      customerId: "cus_inv",
      lineItems: [
        { description: "Pro plan", quantity: 2, unitAmount: "15.00" },
      ],
    });
    expect(created.status).toBe(201);
    expect(created.json.data.status).toBe("draft");
    expect(created.json.data.total.amount).toBe("30");
    const id = created.json.data.id as string;

    const finalized = await call(app, "POST", `/v1/invoices/${id}/finalize`);
    expect(finalized.json.data.status).toBe("open");

    const paid = await call(app, "POST", `/v1/invoices/${id}/pay`);
    expect(paid.json.data.status).toBe("paid");
    expect(paid.json.data.paidAt).toBeTruthy();

    const listed = await call(app, "GET", "/v1/invoices?customerId=cus_inv");
    expect(listed.json.data.length).toBeGreaterThanOrEqual(1);
  });

  it("issues a refund against a confirmed payment and marks it succeeded", async () => {
    const { paymentId, customerId } = await makeConfirmedPayment(app);

    const refund = await call(app, "POST", "/v1/refunds", {
      paymentId,
      customerId,
      amount: "40",
      reason: "customer_request",
    });
    expect(refund.status).toBe(201);
    expect(refund.json.data.status).toBe("pending");
    const refundId = refund.json.data.id as string;

    const succeeded = await call(app, "POST", `/v1/refunds/${refundId}/succeed`);
    expect(succeeded.json.data.status).toBe("succeeded");

    const byPayment = await call(app, "GET", `/v1/refunds?paymentId=${paymentId}`);
    expect(byPayment.json.data).toHaveLength(1);
  });

  it("starts a dunning campaign and records a recovery", async () => {
    const started = await call(app, "POST", "/v1/dunning", {
      subscriptionId: "sub_dun_1",
    });
    expect(started.status).toBe(201);
    expect(started.json.data.status).toBe("active");

    const recovered = await call(app, "POST", "/v1/dunning/sub_dun_1/attempt", {
      outcome: "recovered",
    });
    expect(recovered.json.data.status).toBe("recovered");
  });

  it("opens a dispute on a confirmed payment and resolves it", async () => {
    const { paymentId, customerId } = await makeConfirmedPayment(app);

    const opened = await call(app, "POST", "/v1/disputes", {
      paymentId,
      customerId,
      reason: "fraud",
    });
    expect(opened.status).toBe(201);
    expect(opened.json.data.status).toBe("open");
    const id = opened.json.data.id as string;

    const open = await call(app, "GET", "/v1/disputes?status=open");
    expect(open.json.data.length).toBeGreaterThanOrEqual(1);

    const resolved = await call(app, "POST", `/v1/disputes/${id}/resolve`, {
      outcome: "won",
    });
    expect(resolved.json.data.status).toBe("won");
  });

  it("rejects a payout above available balance, then pays out within it", async () => {
    // A confirmed 40 USDC payment funds org_1's available balance.
    await makeConfirmedPayment(app);

    const overdraft = await call(app, "POST", "/v1/payouts", {
      organizationId: "org_1",
      walletAddress: "0xPayoutWallet",
      amount: "100",
      network: "arc",
    });
    expect(overdraft.status).toBe(400);

    const created = await call(app, "POST", "/v1/payouts", {
      organizationId: "org_1",
      walletAddress: "0xPayoutWallet",
      amount: "30",
      network: "arc",
    });
    expect(created.status).toBe(201);
    expect(created.json.data.status).toBe("pending");
    const id = created.json.data.id as string;

    const paid = await call(app, "POST", `/v1/payouts/${id}/paid`, {
      txHash: "0xpayouttx",
    });
    expect(paid.json.data.status).toBe("paid");
    expect(paid.json.data.txHash).toBe("0xpayouttx");

    const byOrg = await call(app, "GET", "/v1/payouts?organizationId=org_1");
    expect(byOrg.json.data).toHaveLength(1);
  });

  it("isolates tenants: each merchant gets its own org + key and sees only its products", async () => {
    const app = await authedApp();

    const register = async (
      email: string,
    ): Promise<{ apiKey: string; sessionToken: string }> => {
      const res = await app.request("/v1/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "hunter2hunter2", type: "merchant" }),
      });
      const json = (await res.json()) as Json;
      expect(res.status).toBe(201);
      expect(json.data.account.organizationId).toMatch(/^org_/);
      expect(json.data.apiKey).toMatch(/^sk_live_/);
      expect(typeof json.data.sessionToken).toBe("string");
      return { apiKey: json.data.apiKey as string, sessionToken: json.data.sessionToken as string };
    };

    const callAs = async (key: string, method: string, path: string, body?: unknown) => {
      const res = await app.request(path, {
        method,
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return (await res.json()) as Json;
    };

    const merchantA = await register("merchant-a@example.com");
    const merchantB = await register("merchant-b@example.com");
    const keyA = merchantA.apiKey;
    const keyB = merchantB.apiKey;
    expect(keyA).not.toEqual(keyB);

    const product = { merchantId: "m", name: "X", type: "saas_plan", deliveryMode: "saas_entitlement" };
    await callAs(keyA, "POST", "/v1/products", { ...product, name: "Alpha" });
    await callAs(keyB, "POST", "/v1/products", { ...product, name: "Beta" });

    // Each merchant sees ONLY its own product.
    const aList = await callAs(keyA, "GET", "/v1/products");
    const bList = await callAs(keyB, "GET", "/v1/products");
    expect(aList.data.map((p: { name: string }) => p.name)).toEqual(["Alpha"]);
    expect(bList.data.map((p: { name: string }) => p.name)).toEqual(["Beta"]);

    // A client-supplied organizationId on create cannot escape the caller's tenant.
    const evil = await callAs(keyA, "POST", "/v1/products", {
      ...product,
      name: "Evil",
      organizationId: "org_victim",
    });
    expect(evil.data.organizationId).not.toBe("org_victim");
    const bAfter = await callAs(keyB, "GET", "/v1/products");
    expect(bAfter.data.map((p: { name: string }) => p.name)).toEqual(["Beta"]);

    // Customers (a PII boundary) are isolated the same way, and a forged
    // organizationId on create is ignored in favor of the caller's tenant.
    await callAs(keyA, "POST", "/v1/customers", {
      email: "a-buyer@example.com",
      organizationId: "org_victim",
    });
    await callAs(keyB, "POST", "/v1/customers", { email: "b-buyer@example.com" });
    const aCustomers = await callAs(keyA, "GET", "/v1/customers");
    const bCustomers = await callAs(keyB, "GET", "/v1/customers");
    expect(aCustomers.data.map((cu: { email: string }) => cu.email)).toEqual(["a-buyer@example.com"]);
    expect(bCustomers.data.map((cu: { email: string }) => cu.email)).toEqual(["b-buyer@example.com"]);

    // The merchant's SESSION token (what the first-party dashboard sends) is a
    // first-class credential: it resolves to the same org as the API key, so the
    // dashboard sees exactly the same tenant-scoped data.
    const aViaSession = await callAs(merchantA.sessionToken, "GET", "/v1/products");
    const aSessionNames = aViaSession.data.map((p: { name: string }) => p.name);
    expect(aSessionNames).toContain("Alpha");
    expect(aSessionNames).not.toContain("Beta");
    const bViaSession = await callAs(merchantB.sessionToken, "GET", "/v1/customers");
    expect(bViaSession.data.map((cu: { email: string }) => cu.email)).toEqual(["b-buyer@example.com"]);
  });

  it("derives the activation funnel from live data as the merchant progresses", async () => {
    const app = await authedApp();

    // Fresh org: nothing done yet, first step is to create a product.
    const start = await call(app, "GET", "/v1/onboarding");
    expect(start.status).toBe(200);
    expect(start.json.data.complete).toBe(false);
    expect(start.json.data.nextStep.key).toBe("create_product");
    const stepDone = (s: Json, key: string): boolean =>
      s.data.steps.find((x: { key: string }) => x.key === key).done;
    expect(stepDone(start.json, "create_product")).toBe(false);

    // Create a product -> first step flips, next step is to add a price.
    const product = await call(app, "POST", "/v1/products", {
      merchantId: "m",
      name: "Funnel Plan",
      type: "saas_plan",
      deliveryMode: "saas_entitlement",
    });
    const productId = product.json.data.id as string;
    const afterProduct = await call(app, "GET", "/v1/onboarding");
    expect(stepDone(afterProduct.json, "create_product")).toBe(true);
    expect(afterProduct.json.data.nextStep.key).toBe("add_price");

    // Attach a price -> add_price flips.
    await call(app, "POST", `/v1/products/${productId}/prices`, { amount: "25", interval: "monthly" });
    const afterPrice = await call(app, "GET", "/v1/onboarding");
    expect(stepDone(afterPrice.json, "add_price")).toBe(true);
    expect(afterPrice.json.data.nextStep.key).toBe("publish_product");

    // Publish -> publish_product flips; payment/payout remain the open steps.
    await call(app, "POST", `/v1/products/${productId}/publish`, {});
    const afterPublish = await call(app, "GET", "/v1/onboarding");
    expect(stepDone(afterPublish.json, "publish_product")).toBe(true);
    expect(afterPublish.json.data.completed).toBe(3);
    expect(afterPublish.json.data.nextStep.key).toBe("first_payment");
    expect(afterPublish.json.data.percent).toBe(60);
  });

  it("applies the platform take-rate to the merchant's withdrawable balance", async () => {
    // Settle a 40.00 USDC payment. Default take-rate is 2.5% + 0.30:
    //   fee = 1.00 + 0.30 = 1.30 ; net = 38.70.
    await makeConfirmedPayment(app);

    const balance = await call(app, "GET", "/v1/payouts/balance");
    expect(balance.status).toBe(200);
    expect(balance.json.data.grossVolume.amount).toBe("40");
    expect(balance.json.data.platformFees.amount).toBe("1.3");
    expect(balance.json.data.netToMerchant.amount).toBe("38.7");
    // Withdrawable is net of the platform fee (no prior payouts yet).
    expect(balance.json.data.available.amount).toBe("38.7");
    expect(balance.json.data.feeSchedule.bps).toBe(250);

    // A payout for the net amount succeeds; one cent more than net is rejected
    // because the platform's cut is reserved and cannot be withdrawn.
    const ok = await call(app, "POST", "/v1/payouts", {
      walletAddress: "0xMerchantWallet",
      amount: "38.70",
      network: "arc",
    });
    expect(ok.status).toBe(201);

    const tooMuch = await call(app, "POST", "/v1/payouts", {
      walletAddress: "0xMerchantWallet",
      amount: "0.01",
      network: "arc",
    });
    // Balance is now fully drawn down; any further payout exceeds it.
    expect(tooMuch.status).toBe(400);
  });
});
