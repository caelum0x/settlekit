/**
 * Cross-tenant ownership guard (security review HIGH-1 / HIGH-2).
 *
 * Every single-resource route that loads a record by an opaque id must check
 * the record belongs to the authenticated organization. A mismatch answers
 * 404 (never 403) so an intruder cannot even learn the id exists. The owner
 * keeps full access.
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { Hono } from "hono";
import { randomBytes } from "node:crypto";
import type { SettlementVerifier } from "@settlekit/chains";
import { createApp } from "../src/app.js";
import { createContext, type AppContext, type AppEnv } from "../src/context.js";
import { buildDeliveryRunRecord } from "../src/routes/delivery.js";
import type { PayoutExecutor } from "../src/payouts/executor.js";

const BOOTSTRAP = "test-bootstrap-key-ownership";

const baseChainDouble: SettlementVerifier = async (proof, requirements) =>
  proof.network === requirements.network ? { ok: true } : { ok: false, reason: "network mismatch" };

const fakeExecutor: PayoutExecutor = {
  async execute() {
    return { providerRef: "ref_1", state: "PENDING" } as never;
  },
  async reconcile() {
    return { providerRef: "ref_1", state: "PENDING" } as never;
  },
};

const evmTxHash = (): string => `0x${randomBytes(32).toString("hex")}`;

interface Json {
  data?: any;
  error?: { code: string; message: string };
}

interface Ids {
  productId: string;
  priceId: string;
  monthlyPriceId: string;
  customerId: string;
  sessionId: string;
  pendingPaymentId: string;
  confirmedPaymentId: string;
  entitlementId: string;
  subscriptionId: string;
  refundId: string;
  disputeId: string;
  invoiceId: string;
  bundleId: string;
  agentServiceId: string;
  deliveryRunId: string;
  webhookEventId: string;
  payoutId: string;
  licenseId: string;
  listingId: string;
  escrowTaskId: string;
}

let app: Hono<AppEnv>;
let ctx: AppContext;
let intruderKey: string;
const ids = {} as Ids;

async function callAs(
  key: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Json }> {
  const res = await app.request(path, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: Json = {};
  try {
    json = JSON.parse(text) as Json;
  } catch {
    /* html / empty */
  }
  return { status: res.status, json };
}

const owner = (method: string, path: string, body?: unknown) => callAs(BOOTSTRAP, method, path, body);
const intruder = (method: string, path: string, body?: unknown) => callAs(intruderKey, method, path, body);

async function seed(): Promise<void> {
  const product = await owner("POST", "/v1/products", {
    merchantId: "mch_1",
    name: "Owned Widget",
    type: "digital_download",
    deliveryMode: "file_download",
  });
  ids.productId = product.json.data.id;
  ids.priceId = (await owner("POST", `/v1/products/${ids.productId}/prices`, { amount: "40.00" })).json.data.id;
  ids.monthlyPriceId = (
    await owner("POST", `/v1/products/${ids.productId}/prices`, { amount: "10.00", interval: "monthly" })
  ).json.data.id;
  ids.customerId = (await owner("POST", "/v1/customers", { email: "owner-buyer@example.com" })).json.data.id;

  const checkout = (payTo = "0x1111111111111111111111111111111111111111") =>
    owner("POST", "/v1/checkout-sessions", {
      merchantId: "mch_1",
      customerId: ids.customerId,
      items: [{ priceId: ids.priceId, productId: ids.productId, quantity: 1 }],
      payToAddress: payTo,
      network: "base",
    });
  ids.sessionId = (await checkout()).json.data.id;
  ids.pendingPaymentId = (await owner("POST", "/v1/payments", { checkoutSessionId: ids.sessionId })).json.data.id;

  const paidSession = (await checkout()).json.data.id;
  ids.confirmedPaymentId = (await owner("POST", "/v1/payments", { checkoutSessionId: paidSession })).json.data.id;
  const confirmed = await owner("POST", `/v1/payments/${ids.confirmedPaymentId}/confirm`, {
    txHash: evmTxHash(),
    confirmations: 3,
  });
  expect(confirmed.status).toBe(200);
  ids.entitlementId = confirmed.json.data.entitlements[0].id;

  const sub = await owner("POST", "/v1/subscriptions", {
    customerId: ids.customerId,
    productId: ids.productId,
    priceId: ids.monthlyPriceId,
  });
  ids.subscriptionId = sub.json.data.subscription.id;
  expect((await owner("POST", "/v1/dunning", { subscriptionId: ids.subscriptionId })).status).toBe(201);

  ids.refundId = (
    await owner("POST", "/v1/refunds", {
      paymentId: ids.confirmedPaymentId,
      customerId: ids.customerId,
      amount: "1",
      reason: "customer_request",
    })
  ).json.data.id;
  ids.disputeId = (
    await owner("POST", "/v1/disputes", { paymentId: ids.confirmedPaymentId, customerId: ids.customerId, reason: "fraud" })
  ).json.data.id;
  ids.invoiceId = (
    await owner("POST", "/v1/invoices", {
      customerId: ids.customerId,
      lineItems: [{ description: "Pro", quantity: 1, unitAmount: "15.00" }],
    })
  ).json.data.id;
  ids.bundleId = (
    await owner("POST", "/v1/bundles", { merchantId: "mch_1", name: "B", productIds: [ids.productId], amount: "9" })
  ).json.data.id;
  ids.agentServiceId = (
    await owner("POST", "/v1/agent-services", {
      merchantId: "mch_1",
      productId: ids.productId,
      name: "Svc",
      description: "d",
      endpoint: "https://api.example.com/x",
      price: "0.05",
      inputSchema: { type: "object" },
    })
  ).json.data.id;
  const run = buildDeliveryRunRecord({
    organizationId: "org_settlekit_default",
    paymentId: ids.confirmedPaymentId,
    customerId: ids.customerId,
    deliveryPlanId: "plan_1",
    actions: [],
  });
  ids.deliveryRunId = (await ctx.deliveryRuns.save(run)).id;
  ids.webhookEventId = (
    await owner("POST", "/v1/webhooks/events", { type: "payment.confirmed", data: { paymentId: "pay_x" } })
  ).json.data.event.id;
  const payout = await owner("POST", "/v1/payouts", {
    walletAddress: "0x2222222222222222222222222222222222222222",
    amount: "1",
    network: "base",
  });
  expect(payout.status).toBe(201);
  ids.payoutId = payout.json.data.id;
  ids.licenseId = (
    await owner("POST", "/v1/license-keys", {
      customerId: ids.customerId,
      productId: ids.productId,
      entitlementId: ids.entitlementId,
      machineLimit: 1,
    })
  ).json.data.id;
  ids.listingId = (
    await owner("POST", "/v1/marketplace/listings", {
      merchantId: "mch_1",
      productId: ids.productId,
      title: "Listing",
      summary: "s",
    })
  ).json.data.id;
  ids.escrowTaskId = (
    await owner("POST", "/v1/escrow/tasks", {
      organizationId: "ignored",
      buyerCustomerId: ids.customerId,
      title: "t",
      description: "d",
      amount: "5",
    })
  ).json.data.id;
}

beforeAll(async () => {
  process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
  const base = await createContext();
  ctx = { ...base, verifiers: { ...base.verifiers, base: baseChainDouble }, payoutExecutor: fakeExecutor };
  app = createApp(ctx);
  const issued = await ctx.apiKeys.issue({
    organizationId: "org_intruder",
    customerId: "cus_intruder",
    productId: "prod_intruder",
    entitlementId: "ent_intruder",
    scopes: ["*"],
    env: "live",
  });
  intruderKey = issued.plaintext;
  await seed();
}, 120_000);

/** [method, path, body] probes an intruder must see as 404 (built lazily from seeded ids). */
function intruderProbes(): Array<[string, string, unknown?]> {
  return [
    // payments (HIGH-1)
    ["GET", `/v1/payments/${ids.pendingPaymentId}`],
    ["POST", `/v1/payments/${ids.pendingPaymentId}/confirm`, { txHash: evmTxHash(), confirmations: 3 }],
    ["POST", `/v1/payments/${ids.pendingPaymentId}/fail`],
    ["POST", `/v1/payments/${ids.confirmedPaymentId}/refund`],
    ["POST", "/v1/payments", { checkoutSessionId: ids.sessionId }],
    // checkout sessions (HIGH-2)
    ["GET", `/v1/checkout-sessions/${ids.sessionId}`],
    ["POST", `/v1/checkout-sessions/${ids.sessionId}/cancel`],
    ["POST", `/v1/checkout-sessions/${ids.sessionId}/expire`],
    ["POST", `/v1/checkout-sessions/${ids.sessionId}/collect-fields`, { fields: { email: "x@y.z" } }],
    // products + prices
    ["GET", `/v1/products/${ids.productId}`],
    ["POST", `/v1/products/${ids.productId}/publish`],
    ["POST", `/v1/products/${ids.productId}/prices`, { amount: "1.00" }],
    ["GET", `/v1/products/${ids.productId}/prices`],
    // customers
    ["GET", `/v1/customers/${ids.customerId}`],
    // subscriptions + dunning
    ["GET", `/v1/subscriptions/${ids.subscriptionId}`],
    ["POST", `/v1/subscriptions/${ids.subscriptionId}/renew`],
    ["POST", `/v1/subscriptions/${ids.subscriptionId}/cancel`],
    ["POST", "/v1/subscriptions", { customerId: "c", productId: ids.productId, priceId: ids.monthlyPriceId }],
    ["POST", "/v1/dunning", { subscriptionId: ids.subscriptionId }],
    ["POST", `/v1/dunning/${ids.subscriptionId}/attempt`, { outcome: "recovered" }],
    ["POST", `/v1/dunning/${ids.subscriptionId}/recover`],
    // entitlements
    ["GET", `/v1/entitlements/${ids.entitlementId}`],
    ["POST", `/v1/entitlements/${ids.entitlementId}/revoke`, {}],
    // refunds + disputes
    ["POST", "/v1/refunds", { paymentId: ids.confirmedPaymentId, customerId: "c", amount: "1", reason: "customer_request" }],
    ["POST", `/v1/refunds/${ids.refundId}/succeed`],
    ["POST", `/v1/refunds/${ids.refundId}/fail`, {}],
    ["POST", "/v1/disputes", { paymentId: ids.confirmedPaymentId, customerId: "c", reason: "fraud" }],
    ["GET", `/v1/disputes/${ids.disputeId}`],
    ["POST", `/v1/disputes/${ids.disputeId}/evidence`, { kind: "text", description: "d", value: "v" }],
    ["POST", `/v1/disputes/${ids.disputeId}/resolve`, { outcome: "won" }],
    // invoices
    ["GET", `/v1/invoices/${ids.invoiceId}`],
    ["GET", `/v1/invoices/${ids.invoiceId}.html`],
    ["POST", `/v1/invoices/${ids.invoiceId}/finalize`],
    ["POST", `/v1/invoices/${ids.invoiceId}/pay`],
    ["POST", `/v1/invoices/${ids.invoiceId}/void`],
    // bundles
    ["GET", `/v1/bundles/${ids.bundleId}`],
    ["PATCH", `/v1/bundles/${ids.bundleId}`, { name: "pwned" }],
    ["POST", `/v1/bundles/${ids.bundleId}/publish`],
    // agent services
    ["GET", `/v1/agent-services/${ids.agentServiceId}`],
    ["PATCH", `/v1/agent-services/${ids.agentServiceId}`, { name: "pwned" }],
    ["POST", `/v1/agent-services/${ids.agentServiceId}/publish`],
    ["GET", `/v1/agent-services/${ids.agentServiceId}/metadata.json`],
    // delivery runs
    ["GET", `/v1/delivery-runs/${ids.deliveryRunId}`],
    ["POST", `/v1/delivery-runs/${ids.deliveryRunId}/retry`],
    // webhook events
    ["GET", `/v1/webhooks/events/${ids.webhookEventId}`],
    // payouts
    ["POST", `/v1/payouts/${ids.payoutId}/execute`],
    ["POST", `/v1/payouts/${ids.payoutId}/reconcile`],
    ["POST", `/v1/payouts/${ids.payoutId}/paid`, { txHash: evmTxHash() }],
    ["POST", `/v1/payouts/${ids.payoutId}/fail`, {}],
    // license keys
    ["POST", `/v1/license-keys/${ids.licenseId}/token`],
    ["POST", `/v1/license-keys/${ids.licenseId}/revoke`],
    // marketplace (unpublished listing is private to its owner)
    ["GET", `/v1/marketplace/listings/${ids.listingId}`],
    ["POST", `/v1/marketplace/listings/${ids.listingId}/publish`],
    ["POST", `/v1/marketplace/listings/${ids.listingId}/unpublish`],
    ["POST", `/v1/marketplace/listings/${ids.listingId}/rate`, { stars: 1 }],
    // escrow
    ["GET", `/v1/escrow/tasks/${ids.escrowTaskId}`],
    ["POST", `/v1/escrow/tasks/${ids.escrowTaskId}/fund`, { fundingTxHash: "0xabc" }],
    ["POST", `/v1/escrow/tasks/${ids.escrowTaskId}/assign`, { workerCustomerId: "w" }],
    ["POST", `/v1/escrow/tasks/${ids.escrowTaskId}/submit`, { content: "c" }],
    ["POST", `/v1/escrow/tasks/${ids.escrowTaskId}/approve`],
    ["POST", `/v1/escrow/tasks/${ids.escrowTaskId}/release`, { releaseTxHash: "0xabc" }],
    ["POST", `/v1/escrow/tasks/${ids.escrowTaskId}/refund`, {}],
  ];
}

describe("tenant ownership guard", () => {
  it("answers 404 (not 403) to another org on every single-resource route", async () => {
    const leaks: string[] = [];
    for (const [method, path, body] of intruderProbes()) {
      const res = await intruder(method, path, body);
      if (res.status !== 404) leaks.push(`${method} ${path} -> ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it("left the owner's resources untouched by the intruder's attempts", async () => {
    expect((await owner("GET", `/v1/payments/${ids.pendingPaymentId}`)).json.data.status).toBe("pending");
    expect((await owner("GET", `/v1/payments/${ids.confirmedPaymentId}`)).json.data.status).toBe("confirmed");
    expect((await owner("GET", `/v1/checkout-sessions/${ids.sessionId}`)).json.data.status).toBe("open");
    expect((await owner("GET", `/v1/subscriptions/${ids.subscriptionId}`)).json.data.status).not.toBe("canceled");
    expect((await owner("GET", `/v1/entitlements/${ids.entitlementId}`)).json.data.status).toBe("active");
    expect((await owner("GET", `/v1/bundles/${ids.bundleId}`)).json.data.name).toBe("B");
    expect((await owner("GET", `/v1/escrow/tasks/${ids.escrowTaskId}`)).json.data.status).toBe("created");
  });

  it("still serves every resource to its owning org", async () => {
    const reads = [
      `/v1/payments/${ids.pendingPaymentId}`,
      `/v1/checkout-sessions/${ids.sessionId}`,
      `/v1/products/${ids.productId}`,
      `/v1/products/${ids.productId}/prices`,
      `/v1/customers/${ids.customerId}`,
      `/v1/subscriptions/${ids.subscriptionId}`,
      `/v1/entitlements/${ids.entitlementId}`,
      `/v1/disputes/${ids.disputeId}`,
      `/v1/invoices/${ids.invoiceId}`,
      `/v1/invoices/${ids.invoiceId}.html`,
      `/v1/bundles/${ids.bundleId}`,
      `/v1/agent-services/${ids.agentServiceId}`,
      `/v1/agent-services/${ids.agentServiceId}/metadata.json`,
      `/v1/delivery-runs/${ids.deliveryRunId}`,
      `/v1/webhooks/events/${ids.webhookEventId}`,
      `/v1/marketplace/listings/${ids.listingId}`,
      `/v1/escrow/tasks/${ids.escrowTaskId}`,
    ];
    for (const path of reads) {
      expect([path, (await owner("GET", path)).status]).toEqual([path, 200]);
    }
    expect((await owner("POST", `/v1/license-keys/${ids.licenseId}/token`)).status).toBe(200);
    expect((await owner("POST", `/v1/checkout-sessions/${ids.sessionId}/collect-fields`, { fields: { a: "b" } })).status).toBe(200);
  });

  it("rejects a checkout built from another org's price as if the price did not exist", async () => {
    const res = await intruder("POST", "/v1/checkout-sessions", {
      merchantId: "m",
      items: [{ priceId: ids.priceId, quantity: 1 }],
      payToAddress: "0x1111111111111111111111111111111111111111",
      network: "base",
    });
    expect(res.status).toBe(400);
    expect(res.json.error?.message).toContain("price not found");
  });

  it("scopes escrow task creation to the caller's org, never a client-supplied one", async () => {
    const res = await intruder("POST", "/v1/escrow/tasks", {
      organizationId: "org_settlekit_default",
      buyerCustomerId: "c",
      title: "t",
      description: "d",
      amount: "1",
    });
    expect(res.status).toBe(201);
    expect(res.json.data.organizationId).toBe("org_intruder");
  });

  it("shows a published marketplace listing to other orgs but only the owner can unpublish it", async () => {
    expect((await owner("POST", `/v1/marketplace/listings/${ids.listingId}/publish`)).status).toBe(200);
    expect((await intruder("GET", `/v1/marketplace/listings/${ids.listingId}`)).status).toBe(200);
    expect((await intruder("POST", `/v1/marketplace/listings/${ids.listingId}/rate`, { stars: 4 })).status).toBe(200);
    expect((await intruder("POST", `/v1/marketplace/listings/${ids.listingId}/unpublish`)).status).toBe(404);
  });
});
