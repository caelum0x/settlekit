/**
 * x402 v2 agent payments through the real API routes with fake facilitators.
 * The EVM payer is the real x402 client (EIP-3009 signatures from a test key).
 */
import { describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequired } from "@x402/core/types";
import type { FacilitatorEvmSigner } from "@x402/evm";
import { createSpecX402Fetch, readPaymentResponse } from "@settlekit/x402-client";
import { GasGuard, createSettleKitFacilitator } from "@settlekit/x402-facilitator";
import { createApp } from "../src/app.js";
import { createContext, type AppContext, type AppEnv } from "../src/context.js";
import { loadAgentPayments, type AgentPaymentsRuntime } from "../src/agent-payments/config.js";
import { EVM_MERCHANT, SOLANA_SIG, SOL_FEE_PAYER, SOL_MERCHANT, fakeRuntime } from "./support/x402-fakes.js";

const BOOTSTRAP = "test-bootstrap-key";
const agent = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const ORIGIN = "http://api.settlekit.test";

interface Harness {
  app: Hono<AppEnv>;
  ctx: AppContext;
  pay: (network: string) => (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

async function harness(runtime: AgentPaymentsRuntime | null): Promise<Harness> {
  process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
  const base = await createContext();
  const ctx = { ...base, agentPayments: runtime };
  const app = createApp(ctx);
  const appFetch = ((input: RequestInfo | URL, init?: RequestInit) => app.request(new Request(input, init))) as typeof fetch;
  const pay = (network: string) =>
    createSpecX402Fetch({ fetch: appFetch, evmSigner: agent, preferNetworks: [network], maxAtomicPerPayment: "100000000" });
  return { app, ctx, pay };
}

async function admin(app: Hono<AppEnv>, method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { authorization: `Bearer ${BOOTSTRAP}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return (await res.json()) as { data: any };
}

async function publishedProduct(
  app: Hono<AppEnv>,
  options: { deliveryMode?: string; type?: string; amount?: string; publish?: boolean } = {},
): Promise<string> {
  const product = await admin(app, "POST", "/v1/products", {
    merchantId: "mch_1",
    organizationId: "org_1",
    name: "Agent Toolkit",
    description: "CLI license",
    type: options.type ?? "license_key",
    deliveryMode: options.deliveryMode ?? "license_key",
  });
  const id = product.data.id as string;
  await admin(app, "POST", `/v1/products/${id}/prices`, { amount: options.amount ?? "2.50", interval: "one_time" });
  if (options.publish !== false) await admin(app, "POST", `/v1/products/${id}/publish`);
  return id;
}

function challengeOf(res: Response): PaymentRequired {
  const header = res.headers.get("PAYMENT-REQUIRED");
  expect(header).toBeTruthy();
  return decodePaymentRequiredHeader(header as string);
}

describe("GET /v1/x402/research", () => {
  it("answers 402 with one requirement per configured network", async () => {
    const { app } = await harness(fakeRuntime().runtime);
    const res = await app.request("/v1/x402/research");
    expect(res.status).toBe(402);
    const required = challengeOf(res);
    expect(required.x402Version).toBe(2);
    const byNetwork = Object.fromEntries(required.accepts.map((accept) => [accept.network, accept]));

    expect(byNetwork["solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"]).toMatchObject({
      scheme: "exact",
      asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amount: "10000",
      payTo: SOL_MERCHANT,
      extra: { feePayer: SOL_FEE_PAYER },
    });
    expect(byNetwork["eip155:8453"]).toMatchObject({
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      amount: "10000",
      payTo: EVM_MERCHANT,
      extra: { name: "USD Coin", version: "2" },
    });
    expect(byNetwork["eip155:999"]).toMatchObject({
      asset: "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
      extra: { name: "USDC", version: "2" },
    });
    expect(byNetwork["eip155:4663"]).toMatchObject({
      asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      extra: { name: "Global Dollar", version: "1" },
    });
  });

  it("serves the resource once the agent pays, settling through the routed facilitator", async () => {
    const { remote, local, runtime } = fakeRuntime();
    const { pay } = await harness(runtime);
    const res = await pay("eip155:999")(`${ORIGIN}/v1/x402/research`);
    expect(res.status).toBe(200);
    expect((await res.json()).data.answer).toMatch(/Paid research/);
    expect(readPaymentResponse(res)).toMatchObject({ success: true, network: "eip155:999" });
    expect(local.calls.map((call) => call.op)).toEqual(["verify", "settle"]);
    expect(remote.calls).toHaveLength(0);
  });

  it("routes Base payments to the remote facilitator", async () => {
    const { remote, local, runtime } = fakeRuntime();
    const { pay } = await harness(runtime);
    const res = await pay("eip155:8453")(`${ORIGIN}/v1/x402/research`);
    expect(res.status).toBe(200);
    expect(remote.calls.map((call) => `${call.op}:${call.network}`)).toEqual(["verify:eip155:8453", "settle:eip155:8453"]);
    expect(local.calls).toHaveLength(0);
  });

  it("answers 503 with the configuration notes when no network is configured", async () => {
    const { app } = await harness(null);
    const res = await app.request("/v1/x402/research");
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("agent_payments_unavailable");
    expect((await app.request("/v1/x402/facilitator/supported")).status).toBe(404);
  });
});

describe("POST /v1/x402/products/:productId/buy", () => {
  it("challenges with the product price and the settle-before-delivery flow", async () => {
    const { app } = await harness(fakeRuntime().runtime);
    const productId = await publishedProduct(app, { amount: "2.50" });
    const res = await app.request(`/v1/x402/products/${productId}/buy`, { method: "POST" });
    expect(res.status).toBe(402);
    const required = challengeOf(res);
    expect(required.accepts).toHaveLength(4);
    for (const accept of required.accepts) {
      expect(accept.amount).toBe("2500000");
      expect(accept.extra.paymentFlow).toBe("upfront");
    }
  });

  it("settles, records one payment, grants the entitlement and delivers the license key", async () => {
    const { local, runtime } = fakeRuntime();
    const { app, ctx, pay } = await harness(runtime);
    const productId = await publishedProduct(app);
    const res = await pay("eip155:999")(`${ORIGIN}/v1/x402/products/${productId}/buy`, { method: "POST" });
    expect(res.status).toBe(201);
    const body = (await res.json()).data;

    expect(body.payment).toMatchObject({ status: "confirmed", network: "hyperevm", amount: { amount: "2.5" } });
    expect(body.payment.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.entitlement).toMatchObject({ productId, status: "active", grantedBy: { type: "payment", id: body.payment.id } });
    expect(body.delivery.status).toBe("succeeded");
    expect(body.delivery.artifacts[0]).toMatchObject({ type: "license_key_create", status: "succeeded" });
    expect(body.delivery.artifacts[0].output.key).toEqual(expect.any(String));
    expect(body.settlement).toMatchObject({ rail: "x402", network: "hyperevm", payer: agent.address, asset: "USDC" });
    expect(readPaymentResponse(res)).toMatchObject({ success: true, transaction: body.payment.txHash });

    // Settlement happened exactly once, BEFORE delivery produced the artifact.
    expect(local.calls.filter((call) => call.op === "settle")).toHaveLength(1);
    expect(await ctx.payments.findByTxHash(body.payment.txHash)).toMatchObject({ id: body.payment.id });
    expect(await ctx.deliveryRuns.list()).toHaveLength(1);
    const customer = await ctx.customers.findById(body.payment.customerId);
    expect(customer?.walletAddress).toBe(agent.address);
  });

  it("delivers a GitHub repo invite to the login the agent supplied", async () => {
    const { runtime } = fakeRuntime();
    const { app, ctx, pay } = await harness(runtime);
    const productId = await publishedProduct(app, { type: "github_repo_access", deliveryMode: "github_invite" });
    const product = await ctx.products.findById(productId);
    await ctx.products.save({ ...(product as NonNullable<typeof product>), metadata: { repoId: "settlekit/agent-kit" } });
    await ctx.githubInstallations.save({
      id: "ghi_1",
      organizationId: product?.organizationId as string,
      installationId: 4242,
      accountLogin: "settlekit",
      accountType: "Organization",
      createdAt: new Date().toISOString(),
    });
    const res = await pay("eip155:4663")(`${ORIGIN}/v1/x402/products/${productId}/buy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ githubUsername: "octo-agent" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()).data;
    expect(body.payment.network).toBe("robinhood");
    expect(body.settlement.asset).toBe("USDG");
    expect(body.delivery.artifacts[0]).toMatchObject({
      type: "github_invite",
      status: "succeeded",
      output: { repoOwner: "settlekit", repoName: "agent-kit" },
    });
  });

  it("answers 409 for a settlement whose transaction already backs a payment, delivering once", async () => {
    const { local, runtime } = fakeRuntime();
    const { app, ctx, pay } = await harness(runtime);
    const productId = await publishedProduct(app);
    local.script.tx = `0x${"77".repeat(32)}`;
    const first = await pay("eip155:999")(`${ORIGIN}/v1/x402/products/${productId}/buy`, { method: "POST" });
    expect(first.status).toBe(201);
    const orgId = (await first.json()).data.payment.organizationId as string;
    const second = await pay("eip155:999")(`${ORIGIN}/v1/x402/products/${productId}/buy`, { method: "POST" });
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("conflict");
    expect(await ctx.deliveryRuns.list()).toHaveLength(1);
    expect(await ctx.payments.listByOrganization(orgId)).toHaveLength(1);
  });

  it("buys on Solana through the remote facilitator", async () => {
    const { remote, runtime } = fakeRuntime();
    const { app, ctx } = await harness(runtime);
    const productId = await publishedProduct(app);
    const challenge = challengeOf(await app.request(`/v1/x402/products/${productId}/buy`, { method: "POST" }));
    const accepted = challenge.accepts.find((accept) => accept.network.startsWith("solana:"));
    expect(accepted).toBeDefined();
    const payment: PaymentPayload = {
      x402Version: 2,
      resource: challenge.resource,
      accepted: accepted as PaymentPayload["accepted"],
      payload: { transaction: "AQAAAA==" },
    };
    const res = await app.request(`/v1/x402/products/${productId}/buy`, {
      method: "POST",
      headers: { "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payment) },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()).data;
    expect(body.payment).toMatchObject({ network: "solana", txHash: SOLANA_SIG });
    // Upfront flow: the facilitator's settle (which re-verifies) is the only call.
    expect(remote.calls.map((call) => call.op)).toEqual(["settle"]);
    expect(await ctx.payments.findByTxHash(SOLANA_SIG)).not.toBeNull();
  });

  it("never loses a settled payment when fulfilment breaks: 500 with the transaction", async () => {
    const { runtime } = fakeRuntime();
    process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
    const base = await createContext();
    const payments = Object.create(base.payments) as AppContext["payments"];
    payments.save = async () => {
      throw new Error("database unavailable");
    };
    const app = createApp({ ...base, payments, agentPayments: runtime });
    const appFetch = ((input: RequestInfo | URL, init?: RequestInit) => app.request(new Request(input, init))) as typeof fetch;
    const productId = await publishedProduct(app);
    const pay = createSpecX402Fetch({ fetch: appFetch, evmSigner: agent, preferNetworks: ["eip155:999"], maxAtomicPerPayment: "100000000" });
    const res = await pay(`${ORIGIN}/v1/x402/products/${productId}/buy`, { method: "POST" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("fulfilment_failed");
    expect(body.error.details).toMatchObject({ rail: "x402", network: "hyperevm", productId, payer: agent.address });
    expect(body.error.details.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(readPaymentResponse(res)).toMatchObject({ success: true });
  });

  it("turns a lost race on the tx-hash unique index into 409 without a second delivery", async () => {
    const { local, runtime } = fakeRuntime();
    process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
    const base = await createContext();
    let stale = false;
    const payments = Object.create(base.payments) as AppContext["payments"];
    payments.findByTxHash = async (txHash) => {
      if (stale) {
        stale = false; // a concurrent request has not committed yet when we check
        return null;
      }
      return base.payments.findByTxHash(txHash);
    };
    payments.save = async (payment) => {
      const existing = payment.txHash ? await base.payments.findByTxHash(payment.txHash) : null;
      if (existing && existing.id !== payment.id) throw new Error('duplicate key value violates unique constraint "payments_tx_hash_unique_idx"');
      return base.payments.save(payment);
    };
    const ctx = { ...base, payments, agentPayments: runtime };
    const app = createApp(ctx);
    const appFetch = ((input: RequestInfo | URL, init?: RequestInit) => app.request(new Request(input, init))) as typeof fetch;
    const pay = createSpecX402Fetch({ fetch: appFetch, evmSigner: agent, preferNetworks: ["eip155:999"], maxAtomicPerPayment: "100000000" });
    const productId = await publishedProduct(app);
    local.script.tx = `0x${"88".repeat(32)}`;
    expect((await pay(`${ORIGIN}/v1/x402/products/${productId}/buy`, { method: "POST" })).status).toBe(201);
    stale = true;
    const raced = await pay(`${ORIGIN}/v1/x402/products/${productId}/buy`, { method: "POST" });
    expect(raced.status).toBe(409);
    expect(await ctx.deliveryRuns.list()).toHaveLength(1);
  });

  it("records nothing when settlement fails", async () => {
    const { local, runtime } = fakeRuntime();
    const { app, ctx, pay } = await harness(runtime);
    const productId = await publishedProduct(app);
    local.script.fail = "insufficient_funds";
    const res = await pay("eip155:999")(`${ORIGIN}/v1/x402/products/${productId}/buy`, { method: "POST" });
    expect(res.status).toBe(402);
    const orgId = (await ctx.products.findById(productId))?.organizationId as string;
    expect(await ctx.payments.listByOrganization(orgId)).toHaveLength(0);
    expect(local.calls.map((call) => call.op)).toEqual(["settle"]);
    expect(await ctx.deliveryRuns.list()).toHaveLength(0);
  });

  it("rejects unknown, unpublished or under-specified purchases before any challenge", async () => {
    const { local, runtime } = fakeRuntime();
    const { app } = await harness(runtime);
    expect((await app.request("/v1/x402/products/prod_missing/buy", { method: "POST" })).status).toBe(404);
    const draft = await publishedProduct(app, { publish: false });
    expect((await app.request(`/v1/x402/products/${draft}/buy`, { method: "POST" })).status).toBe(404);

    const repo = await publishedProduct(app, { type: "github_repo_access", deliveryMode: "github_invite" });
    const missing = await app.request(`/v1/x402/products/${repo}/buy`, { method: "POST" });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.message).toMatch(/githubUsername/);
    const withLogin = await app.request(`/v1/x402/products/${repo}/buy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ githubUsername: "octo-agent" }),
    });
    expect(withLogin.status).toBe(402);
    expect(local.calls).toHaveLength(0);
  });
});

describe("GET /v1/x402/networks and env wiring", () => {
  it("lists what an agent can pay with", async () => {
    const { app } = await harness(fakeRuntime().runtime);
    const body = (await (await app.request("/v1/x402/networks")).json()).data;
    expect(body.networks.map((entry: { network: string }) => entry.network)).toEqual(["solana", "base", "hyperevm", "robinhood"]);
    expect(body.mpp).toBeNull();
  });

  it("offers a remote network only with a valid payTo and explains the rest", () => {
    const runtime = loadAgentPayments(
      {
        SETTLEKIT_CHAIN_ENV: "mainnet",
        SOLANA_CLUSTER: "mainnet",
        X402_EVM_PAY_TO: EVM_MERCHANT,
        X402_SOLANA_PAY_TO: "not-a-solana-address",
      },
      { localFacilitator: null },
    );
    expect(runtime?.networks.map((entry) => entry.network)).toEqual(["base", "arbitrum"]);
    expect(runtime?.notes.join("\n")).toMatch(/solana: set a valid X402_SOLANA_PAY_TO/);
    expect(runtime?.networks[0]).toMatchObject({ facilitator: "remote", extra: { name: "USD Coin", version: "2" } });
  });

  it("is off when nothing is configured", () => {
    expect(loadAgentPayments({}, { localFacilitator: null })).toBeNull();
  });
});

describe("/v1/x402/facilitator (self-hosted)", () => {
  it("exposes /supported publicly and guards /settle with the bearer token", async () => {
    const { runtime } = fakeRuntime();
    const relayer = "0x3333333333333333333333333333333333333333" as const;
    const signer: FacilitatorEvmSigner = {
      getAddresses: () => [relayer],
      readContract: async () => undefined,
      verifyTypedData: async () => false,
      writeContract: async () => `0x${"00".repeat(32)}`,
      sendTransaction: async () => `0x${"00".repeat(32)}`,
      waitForTransactionReceipt: async () => ({ status: "success" }),
      getCode: async () => "0x",
    };
    const localFacilitator = createSettleKitFacilitator({
      env: "mainnet",
      enabledNetworks: ["hyperevm"],
      signerFor: () => signer,
      gasGuard: new GasGuard(
        { gasPrice: async () => 1n, relayerBalance: async () => 10n ** 18n },
        { networks: { "eip155:999": { maxFeePerSettlement: 10n ** 15n } } },
      ),
      maxAmountPerSettlement: 100_000_000n,
    });
    const { app } = await harness({ ...runtime, localFacilitator, facilitatorToken: "facilitator-secret" });
    const supported = await app.request("/v1/x402/facilitator/supported");
    expect(supported.status).toBe(200);
    const body = await supported.json();
    expect(body.kinds).toEqual([{ x402Version: 2, scheme: "exact", network: "eip155:999" }]);
    expect(Object.values(body.signers).flat()).toContain(relayer);
    const assets = await (await app.request("/v1/x402/facilitator/assets")).json();
    expect(assets.assets[0]).toMatchObject({ network: "hyperevm", eip712: { name: "USDC", version: "2" } });
    const settle = await app.request("/v1/x402/facilitator/settle", { method: "POST", body: "{}" });
    expect(settle.status).toBe(401);
  });
});
