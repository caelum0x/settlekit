/**
 * API wiring for HyperCore (verifier registry + ledger verification through
 * an injected Hyperliquid transport), Tempo requireMemo on session creation,
 * and routed-fill session bindings.
 */
import { describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { CheckoutSession } from "@settlekit/common";
import type { HyperliquidTransport, LedgerUpdate } from "@settlekit/hyperliquid";
import { createApp } from "../src/app.js";
import { createContext, type AppEnv } from "../src/context.js";
import { loadConfig } from "../src/config/env.js";
import { buildVerifierRegistry } from "../src/config/verifier-registry.js";
import { isRoutedFill, sessionCheck } from "../src/routes/payment-verification.js";

const BOOTSTRAP = "test-bootstrap-key";
const PAY_TO = "0x1111111111111111111111111111111111111111";
const BUYER = "0x2222222222222222222222222222222222222222";
const HASH = `0x${"7b".repeat(32)}`;

function transport(ledger: LedgerUpdate[]): HyperliquidTransport {
  return {
    isTestnet: false,
    async request<T>(_endpoint: "info" | "exchange", payload: unknown): Promise<T> {
      const { startTime } = payload as { startTime: number };
      return ledger.filter((entry) => entry.time >= startTime) as T;
    },
  };
}

describe("HyperCore verifier registry", () => {
  it("registers hypercore only when HYPERCORE_ENABLED", () => {
    expect(buildVerifierRegistry(loadConfig({})).verifiers.hypercore).toBeUndefined();
    const config = loadConfig({ HYPERCORE_ENABLED: "true", HYPERCORE_NETWORK: "mainnet" });
    expect(config).toMatchObject({ hasHyperCore: true, hypercore: { network: "mainnet", apiUrl: "https://api.hyperliquid.xyz" } });
    expect(buildVerifierRegistry(config).verifiers.hypercore).toBeTypeOf("function");
    expect(() => loadConfig({ HYPERCORE_ENABLED: "maybe" })).toThrow(/HYPERCORE_ENABLED/);
  });

  it("verifies a usdSend credit against the session bindings", async () => {
    const credit: LedgerUpdate = {
      time: Date.parse("2026-09-29T12:00:00Z"),
      hash: HASH,
      delta: { type: "internalTransfer", usdc: "25.0", user: BUYER, destination: PAY_TO, fee: "0.0" },
    };
    const registry = buildVerifierRegistry(loadConfig({ HYPERCORE_ENABLED: "true" }), { hypercoreTransport: transport([credit]) });
    const verify = registry.verifiers.hypercore!;
    const proof = { txHash: HASH, from: "", amount: "", network: "hypercore" as const, nonce: "" };
    const requirements = {
      scheme: "x402", amount: "25", asset: "USDC", network: "hypercore" as const, payTo: PAY_TO, productId: "", resource: "r", nonce: "",
      notBefore: "2026-09-29T11:00:00Z",
    };
    expect(await verify(proof, requirements)).toEqual({ ok: true, confirmations: 1 });
    expect(await verify(proof, { ...requirements, amount: "25.01" })).toMatchObject({ ok: false });
    expect(await verify(proof, { ...requirements, payer: PAY_TO })).toMatchObject({ ok: false, reason: expect.stringMatching(/payer/) });
  });
});

async function app(): Promise<Hono<AppEnv>> {
  process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
  return createApp(await createContext());
}

async function call(target: Hono<AppEnv>, method: string, path: string, body?: unknown) {
  const res = await target.request(path, {
    method,
    headers: { authorization: `Bearer ${BOOTSTRAP}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as { data?: any; error?: { code: string; message: string } } };
}

async function createSession(target: Hono<AppEnv>, body: Record<string, unknown>) {
  const product = await call(target, "POST", "/v1/products", {
    merchantId: "mch_1", organizationId: "org_1", name: "Repo", description: "Source", type: "github_repo_access", deliveryMode: "github_invite",
  });
  const price = await call(target, "POST", `/v1/products/${product.json.data.id}/prices`, { amount: "25.00", interval: "one_time" });
  return call(target, "POST", "/v1/checkout-sessions", {
    merchantId: "mch_1", items: [{ priceId: price.json.data.id, productId: product.json.data.id, quantity: 1 }], ...body,
  });
}

describe("checkout sessions: hypercore and Tempo requireMemo", () => {
  it("creates HyperCore sessions with an EVM-style payTo", async () => {
    const target = await app();
    const ok = await createSession(target, { payToAddress: PAY_TO, network: "hypercore" });
    expect(ok.status).toBe(201);
    const bad = await createSession(target, { payToAddress: "t1Ne88F8ouCV92brDXNBB47a85brvnEHE8g", network: "hypercore" });
    expect(bad.status).toBe(400);
  });

  it("stores requireMemo for Tempo and refuses it without Tempo", async () => {
    const target = await app();
    const tempo = await createSession(target, { payToAddress: PAY_TO, network: "tempo", requireMemo: true });
    expect(tempo.status).toBe(201);
    expect(tempo.json.data.requireMemo).toBe(true);
    const base = await createSession(target, { payToAddress: PAY_TO, network: "base", requireMemo: true });
    expect(base.status).toBe(400);
  });
});

describe("routed fill bindings", () => {
  const session = {
    id: "cs_1",
    amount: { amount: "25", currency: "USDC" },
    payToAddress: PAY_TO,
    network: "tempo",
    createdAt: "2026-09-29T11:00:00Z",
    payerAddress: BUYER,
    requireMemo: true,
    route: {
      provider: "relay", requestId: "0x1", network: "tempo", originChainId: 8453, originToken: "0x0", originAmount: "1",
      originAddress: BUYER, quotedAt: "2026-09-29T11:00:00Z", expiresAt: "2026-09-29T11:02:00Z", state: "success", destinationTxHash: HASH,
    },
  } as unknown as CheckoutSession;

  it("drops the payer and memo bindings only for the provider's fill", () => {
    expect(isRoutedFill(session, "tempo", HASH.toUpperCase().replace("0X", "0x"))).toBe(true);
    const routed = sessionCheck(session, "tempo", HASH);
    expect(routed).not.toHaveProperty("payer");
    expect(routed).not.toHaveProperty("requireMemo");
    expect(routed).toMatchObject({ payTo: PAY_TO, amount: "25", notBefore: session.createdAt });
    const direct = sessionCheck(session, "tempo", `0x${"01".repeat(32)}`);
    expect(direct).toMatchObject({ payer: BUYER, requireMemo: true });
    expect(isRoutedFill(session, "base", HASH)).toBe(false);
  });
});
