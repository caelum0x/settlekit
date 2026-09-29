/**
 * MPP (mppx) on Tempo through the real API routes. The server charge method
 * is the real Tempo `charge` intent schema (mppx/tempo Methods.charge) with a
 * fake on-chain verifier; the client is the real mppx client with a fake
 * credential creator, so challenge issuance, HMAC binding, credential
 * serialization and receipts are all mppx's own.
 */
import { describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { Challenge, Credential, Method, Receipt } from "mppx";
import { Mppx as MppxClient } from "mppx/client";
import { Methods } from "mppx/tempo";
import { getEvmChain } from "@settlekit/chains";
import { createApp } from "../src/app.js";
import { createContext, type AppContext, type AppEnv } from "../src/context.js";
import { loadAgentPayments, type AgentPaymentsRuntime } from "../src/agent-payments/config.js";
import type { MppRuntime } from "../src/agent-payments/mpp.js";
import { EVM_MERCHANT, fakeRuntime } from "./support/x402-fakes.js";

const BOOTSTRAP = "test-bootstrap-key";
const ORIGIN = "http://api.settlekit.test";
const PAYER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const tempo = getEvmChain("tempo", "mainnet");

interface FakeTempo {
  runtime: MppRuntime;
  verified: Array<{ amount: string; hash: string; recipient?: string }>;
}

/** The real Tempo charge intent with a scripted on-chain verification. */
function fakeTempo(): FakeTempo {
  const verified: FakeTempo["verified"] = [];
  const charge = Method.toServer(Methods.charge, {
    defaults: { currency: tempo?.token.address as string, decimals: 6, recipient: EVM_MERCHANT },
    async verify({ credential }) {
      const payload = credential.payload as { type: string; hash?: string };
      if (payload.type !== "hash" || !payload.hash) throw new Error("expected a hash credential");
      const request = credential.challenge.request as { amount: string; recipient?: string };
      verified.push({ amount: request.amount, hash: payload.hash, ...(request.recipient ? { recipient: request.recipient } : {}) });
      return Receipt.from({ method: "tempo", reference: payload.hash, status: "success", timestamp: new Date().toISOString() });
    },
  });
  return {
    verified,
    runtime: {
      secretKey: "test-mpp-secret-key-with-at-least-32-bytes!!",
      realm: "settlekit-test",
      env: "mainnet",
      chainId: tempo?.chainId as number,
      currency: tempo?.token.address as string,
      symbol: "USDC.e",
      decimals: 6,
      recipient: EVM_MERCHANT,
      charge: charge as unknown as Method.AnyServer,
    },
  };
}

/** A real mppx client whose credential is a fake Tempo transfer hash. */
function agentClient(app: Hono<AppEnv>, hash: () => string) {
  const client = Method.toClient(Methods.charge, {
    async createCredential({ challenge }) {
      return Credential.serialize(
        Credential.from({ challenge, payload: { type: "hash", hash: hash() }, source: `did:pkh:eip155:4217:${PAYER}` }),
      );
    },
  });
  return MppxClient.create({
    methods: [client],
    polyfill: false,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => app.request(new Request(input, init))) as typeof fetch,
  });
}

async function harness(mpp: MppRuntime | null): Promise<{ app: Hono<AppEnv>; ctx: AppContext }> {
  process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
  const base = await createContext();
  const runtime: AgentPaymentsRuntime = { ...fakeRuntime().runtime, mpp };
  const ctx = { ...base, agentPayments: runtime };
  return { app: createApp(ctx), ctx };
}

async function licenseProduct(app: Hono<AppEnv>, amount = "3.00"): Promise<string> {
  const call = async (path: string, body?: unknown) =>
    (await (
      await app.request(path, {
        method: "POST",
        headers: { authorization: `Bearer ${BOOTSTRAP}`, "content-type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    ).json()) as { data: { id: string } };
  const product = await call("/v1/products", {
    merchantId: "mch_1",
    name: "Tempo Toolkit",
    type: "license_key",
    deliveryMode: "license_key",
  });
  await call(`/v1/products/${product.data.id}/prices`, { amount, interval: "one_time" });
  await call(`/v1/products/${product.data.id}/publish`);
  return product.data.id;
}

describe("MPP on Tempo", () => {
  it("challenges with a WWW-Authenticate Payment header bound to the product price", async () => {
    const { app } = await harness(fakeTempo().runtime);
    const productId = await licenseProduct(app);
    const res = await app.request(`/v1/mpp/products/${productId}/buy`, { method: "POST" });
    expect(res.status).toBe(402);
    const header = res.headers.get("WWW-Authenticate") ?? "";
    expect(header).toMatch(/^Payment /);
    expect(header).toMatch(/method="tempo"/);
    expect(header).toMatch(/intent="charge"/);
  });

  it("round-trips challenge -> credential -> receipt and delivers once", async () => {
    const fake = fakeTempo();
    const { app, ctx } = await harness(fake.runtime);
    const productId = await licenseProduct(app, "3.00");
    const hash = `0x${"5a".repeat(32)}`;
    const mppx = agentClient(app, () => hash);

    const res = await mppx.fetch(`${ORIGIN}/v1/mpp/products/${productId}/buy`, { method: "POST" });
    expect(res.status).toBe(201);
    const receipt = Receipt.fromResponse(res);
    expect(receipt).toMatchObject({ method: "tempo", reference: hash, status: "success" });
    const body = (await res.json()).data;
    expect(body.payment).toMatchObject({ network: "tempo", txHash: hash, status: "confirmed", amount: { amount: "3" } });
    expect(body.settlement).toMatchObject({ rail: "mpp", payer: PAYER, asset: "USDC.e" });
    expect(body.delivery.artifacts[0]).toMatchObject({ type: "license_key_create", status: "succeeded" });
    expect(fake.verified).toEqual([{ amount: "3000000", hash, recipient: EVM_MERCHANT }]);

    // The same on-chain transfer cannot buy twice.
    const again = await mppx.fetch(`${ORIGIN}/v1/mpp/products/${productId}/buy`, { method: "POST" });
    expect(again.status).toBe(409);
    expect(await ctx.deliveryRuns.list()).toHaveLength(1);
  });

  it("serves the sample resource behind the mppx Hono middleware", async () => {
    const fake = fakeTempo();
    const { app } = await harness(fake.runtime);
    const unpaid = await app.request("/v1/mpp/research");
    expect(unpaid.status).toBe(402);
    const mppx = agentClient(app, () => `0x${"6b".repeat(32)}`);
    const paid = await mppx.fetch(`${ORIGIN}/v1/mpp/research`);
    expect(paid.status).toBe(200);
    expect((await paid.json()).data.answer).toMatch(/Tempo/);
    expect(Receipt.fromResponse(paid).reference).toBe(`0x${"6b".repeat(32)}`);
    expect(fake.verified[0]?.amount).toBe("10000");
  });

  it("rejects a credential minted for a different price", async () => {
    const fake = fakeTempo();
    const { app } = await harness(fake.runtime);
    const cheap = await licenseProduct(app, "0.01");
    const pricey = await licenseProduct(app, "50.00");
    const challengeRes = await app.request(`/v1/mpp/products/${cheap}/buy`, { method: "POST" });
    const challenge = Challenge.fromResponse(challengeRes);
    const credential = Credential.serialize(
      Credential.from({ challenge, payload: { type: "hash", hash: `0x${"7c".repeat(32)}` } }),
    );
    const res = await app.request(`/v1/mpp/products/${pricey}/buy`, {
      method: "POST",
      headers: { authorization: credential },
    });
    expect(res.status).toBe(402);
    expect(fake.verified).toHaveLength(0);
    // Control: the same credential is valid for the product it was issued for.
    const ok = await app.request(`/v1/mpp/products/${cheap}/buy`, { method: "POST", headers: { authorization: credential } });
    expect(ok.status).toBe(201);
    expect(fake.verified).toHaveLength(1);
  });

  it("builds the real mppx Tempo charge from env and issues a mainnet USDC.e challenge", async () => {
    const runtime = loadAgentPayments(
      {
        MPP_SECRET_KEY: "an-mpp-secret-key-that-is-at-least-32-bytes",
        MPP_TEMPO_RECIPIENT: EVM_MERCHANT,
        TEMPO_NETWORK: "mainnet",
      },
      { localFacilitator: null },
    );
    expect(runtime?.mpp).toMatchObject({ chainId: 4217, currency: tempo?.token.address, symbol: "USDC.e", recipient: EVM_MERCHANT });
    const { app } = await harness(runtime?.mpp ?? null);
    const res = await app.request("/v1/mpp/research");
    expect(res.status).toBe(402);
    const challenge = Challenge.fromResponse(res);
    expect(challenge).toMatchObject({ method: "tempo", intent: "charge" });
    expect(challenge.request).toMatchObject({ amount: "10000", currency: tempo?.token.address, recipient: EVM_MERCHANT });
  });

  it("refuses a short MPP secret", () => {
    const runtime = loadAgentPayments(
      { MPP_SECRET_KEY: "short", MPP_TEMPO_RECIPIENT: EVM_MERCHANT, X402_EVM_PAY_TO: EVM_MERCHANT, SETTLEKIT_CHAIN_ENV: "mainnet" },
      { localFacilitator: null },
    );
    expect(runtime?.mpp).toBeNull();
    expect(runtime?.notes.join("\n")).toMatch(/MPP_SECRET_KEY/);
  });

  it("answers 503 when MPP is not configured", async () => {
    const { app } = await harness(null);
    expect((await app.request("/v1/mpp/research")).status).toBe(503);
  });
});
