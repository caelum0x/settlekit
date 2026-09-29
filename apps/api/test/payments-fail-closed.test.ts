/**
 * Fail-closed payment confirmation and the per-network verifier registry.
 *
 * Drives product -> price -> customer -> checkout session -> payment -> confirm
 * through the real routes, with verifiers injected per test:
 *   - no verifier for the network   -> confirm/observe rejected (fail closed)
 *   - a transaction hash can settle only one payment (409 on reuse)
 *   - Solana is NOT supported on this build: solana sessions/observations are
 *     rejected as an unsupported network
 */
import { describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { PaymentProof, PaymentRequirements, PaymentVerifier } from "@settlekit/x402";
import { createApp } from "../src/app.js";
import { createContext, type AppEnv } from "../src/context.js";
import type { PaymentVerifiers } from "../src/config/integrations.js";

const BOOTSTRAP = "test-bootstrap-key";
const MERCHANT = "0x1111111111111111111111111111111111111111";
const BUYER = "0x2222222222222222222222222222222222222222";
const HASH_A = `0x${"ab".repeat(32)}`;
const HASH_B = `0x${"cd".repeat(32)}`;

interface Json {
  data?: any;
  error?: { code: string; message: string };
}

async function appWith(verifiers: PaymentVerifiers): Promise<Hono<AppEnv>> {
  process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
  const ctx = await createContext();
  return createApp({ ...ctx, verifiers });
}

async function call(app: Hono<AppEnv>, method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { authorization: `Bearer ${BOOTSTRAP}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function createPrice(app: Hono<AppEnv>): Promise<{ priceId: string; productId: string; customerId: string }> {
  const product = await call(app, "POST", "/v1/products", {
    merchantId: "mch_1",
    organizationId: "org_1",
    name: "Private Repo",
    description: "Source access",
    type: "github_repo_access",
    deliveryMode: "github_invite",
  });
  const productId = product.json.data.id as string;
  const price = await call(app, "POST", `/v1/products/${productId}/prices`, {
    amount: "25.00",
    interval: "one_time",
  });
  const customer = await call(app, "POST", "/v1/customers", {
    organizationId: "org_1",
    email: "buyer@example.com",
  });
  return { priceId: price.json.data.id as string, productId, customerId: customer.json.data.id as string };
}

/** Create product/price/customer and an open checkout session + pending payment. */
async function openSessionWithPayment(
  app: Hono<AppEnv>,
  network: "arc" | "base" = "arc",
): Promise<{ sessionId: string; paymentId: string; customerId: string; productId: string }> {
  const { priceId, productId, customerId } = await createPrice(app);
  const checkout = await call(app, "POST", "/v1/checkout-sessions", {
    merchantId: "mch_1",
    customerId,
    items: [{ priceId, productId, quantity: 1 }],
    payToAddress: MERCHANT,
    network,
  });
  expect(checkout.status).toBe(201);
  const payment = await call(app, "POST", "/v1/payments", { checkoutSessionId: checkout.json.data.id });
  expect(payment.status).toBe(201);
  return {
    sessionId: checkout.json.data.id as string,
    paymentId: payment.json.data.id as string,
    customerId,
    productId,
  };
}

function recordingVerifier(result = { ok: true }): PaymentVerifier & {
  seen: Array<{ proof: PaymentProof; requirements: PaymentRequirements }>;
} {
  const seen: Array<{ proof: PaymentProof; requirements: PaymentRequirements }> = [];
  const verifier = (async (proof: PaymentProof, requirements: PaymentRequirements) => {
    seen.push({ proof, requirements });
    return result;
  }) as PaymentVerifier & { seen: typeof seen };
  verifier.seen = seen;
  return verifier;
}

describe("checkout sessions: supported networks", () => {
  it("rejects network solana as unsupported", async () => {
    const app = await appWith({ arc: recordingVerifier() });
    const { priceId, productId, customerId } = await createPrice(app);
    const res = await call(app, "POST", "/v1/checkout-sessions", {
      merchantId: "mch_1",
      customerId,
      items: [{ priceId, productId }],
      payToAddress: "mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN",
      network: "solana",
    });
    expect(res.status).toBe(400);
    expect(res.json.error?.code).toBe("validation_error");
    expect(JSON.stringify(res.json.error)).toMatch(/unsupported network/);
  });
});

describe("POST /v1/payments/:id/confirm (fail closed)", () => {
  it("rejects an arc confirmation when no arc verifier is configured", async () => {
    const app = await appWith({});
    const { paymentId, customerId, productId } = await openSessionWithPayment(app);

    const res = await call(app, "POST", `/v1/payments/${paymentId}/confirm`, { txHash: HASH_A, confirmations: 3 });
    expect(res.status).toBe(400);
    expect(res.json.error?.message).toMatch(/not configured for network "arc"/);

    const payment = await call(app, "GET", `/v1/payments/${paymentId}`);
    expect(payment.json.data.status).toBe("pending");
    const access = await call(app, "POST", "/v1/entitlements/verify", { customerId, productId });
    expect(access.json.data.allowed).toBe(false);
  });

  it("confirms via a verifier and grants the entitlement, passing payTo/amount", async () => {
    const verifier = recordingVerifier();
    const app = await appWith({ arc: verifier });
    const { paymentId, customerId, productId, sessionId } = await openSessionWithPayment(app);

    const res = await call(app, "POST", `/v1/payments/${paymentId}/confirm`, { txHash: HASH_A, confirmations: 3 });
    expect(res.status).toBe(200);
    expect(res.json.data.payment.status).toBe("confirmed");
    expect(res.json.data.payment.txHash).toBe(HASH_A);
    expect(res.json.data.entitlements).toHaveLength(1);

    expect(verifier.seen).toHaveLength(1);
    expect(verifier.seen[0]?.proof).toMatchObject({ txHash: HASH_A, network: "arc" });
    expect(verifier.seen[0]?.requirements).toMatchObject({
      network: "arc",
      payTo: MERCHANT,
      amount: "25",
      resource: `checkout_session:${sessionId}`,
    });

    const access = await call(app, "POST", "/v1/entitlements/verify", { customerId, productId });
    expect(access.json.data.allowed).toBe(true);
  });

  it("surfaces the verifier's rejection reason and does not confirm", async () => {
    const app = await appWith({ arc: recordingVerifier({ ok: false, reason: "underpaid" } as { ok: true }) });
    const { paymentId } = await openSessionWithPayment(app);
    const res = await call(app, "POST", `/v1/payments/${paymentId}/confirm`, { txHash: HASH_A, confirmations: 3 });
    expect(res.status).toBe(400);
    expect(res.json.error?.message).toMatch(/underpaid/);
  });

  it("returns 409 when a transaction hash is reused for a second payment", async () => {
    const app = await appWith({ arc: recordingVerifier() });
    const first = await openSessionWithPayment(app);
    const second = await openSessionWithPayment(app);

    const ok = await call(app, "POST", `/v1/payments/${first.paymentId}/confirm`, { txHash: HASH_A, confirmations: 3 });
    expect(ok.status).toBe(200);
    // Idempotent re-confirm of the SAME payment with the same hash is allowed.
    const again = await call(app, "POST", `/v1/payments/${first.paymentId}/confirm`, { txHash: HASH_A, confirmations: 3 });
    expect(again.status).toBe(200);

    const replay = await call(app, "POST", `/v1/payments/${second.paymentId}/confirm`, { txHash: HASH_A, confirmations: 3 });
    expect(replay.status).toBe(409);
    expect(replay.json.error?.code).toBe("conflict");
    const stillPending = await call(app, "GET", `/v1/payments/${second.paymentId}`);
    expect(stillPending.json.data.status).toBe("pending");

    // Recording a new pending payment with an already-used hash is refused too.
    const squat = await call(app, "POST", "/v1/payments", { checkoutSessionId: second.sessionId, txHash: HASH_A });
    expect(squat.status).toBe(409);
  });

  it("treats EVM hashes case-insensitively for uniqueness", async () => {
    const app = await appWith({ base: recordingVerifier() });
    const first = await openSessionWithPayment(app, "base");
    const second = await openSessionWithPayment(app, "base");
    expect((await call(app, "POST", `/v1/payments/${first.paymentId}/confirm`, { txHash: HASH_A, confirmations: 3 })).status).toBe(200);
    const upper = await call(app, "POST", `/v1/payments/${second.paymentId}/confirm`, {
      txHash: `0x${"AB".repeat(32)}`,
      confirmations: 3,
    });
    expect(upper.status).toBe(409);
  });

  it("regression: a base payment cannot be confirmed without a base verifier", async () => {
    const app = await appWith({ arc: recordingVerifier() });
    const { paymentId, customerId, productId } = await openSessionWithPayment(app, "base");
    const res = await call(app, "POST", `/v1/payments/${paymentId}/confirm`, {
      txHash: HASH_B,
      confirmations: 50,
    });
    expect(res.status).toBe(400);
    expect(res.json.error?.message).toMatch(/not configured for network "base"/);
    const access = await call(app, "POST", "/v1/entitlements/verify", { customerId, productId });
    expect(access.json.data.allowed).toBe(false);
  });
});

describe("POST /v1/payments/observe (fail closed)", () => {
  const observe = { txHash: HASH_A, to: MERCHANT, amount: "25", network: "arc", from: BUYER };

  it("fails closed without an arc verifier", async () => {
    const app = await appWith({});
    const res = await call(app, "POST", "/v1/payments/observe", observe);
    expect(res.status).toBe(400);
    expect(res.json.error?.message).toMatch(/not configured for network "arc"/);
  });

  it("rejects solana observations as an unsupported network", async () => {
    const app = await appWith({ arc: recordingVerifier() });
    const res = await call(app, "POST", "/v1/payments/observe", {
      ...observe,
      network: "solana",
      txHash: "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW",
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.json.error)).toMatch(/unsupported network/);
  });

  it("validates 0x hash and address formats", async () => {
    const app = await appWith({ arc: recordingVerifier() });
    const badHash = await call(app, "POST", "/v1/payments/observe", { ...observe, txHash: "0xdeadbeef" });
    expect(badHash.status).toBe(400);
    const badTo = await call(app, "POST", "/v1/payments/observe", { ...observe, to: "merchant" });
    expect(badTo.status).toBe(400);
  });

  it("records a verified arc transfer once and dedupes the replay", async () => {
    const app = await appWith({ arc: recordingVerifier() });
    const first = await call(app, "POST", "/v1/payments/observe", observe);
    expect(first.status).toBe(201);
    expect(first.json.data.payment).toMatchObject({ network: "arc", status: "confirmed", txHash: HASH_A });
    const again = await call(app, "POST", "/v1/payments/observe", observe);
    expect(again.status).toBe(200);
    expect(again.json.data.deduped).toBe(true);
  });
});
