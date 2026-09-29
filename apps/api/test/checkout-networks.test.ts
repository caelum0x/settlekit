/**
 * Checkout-session network bindings (acceptedNetworks, payToByNetwork, Zcash
 * quote locking with unique amount tags), the multi-chain verifier registry
 * and chain env loading.
 */
import { describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { usdToZats } from "@settlekit/zcash";
import { createApp } from "../src/app.js";
import { createContext, type AppEnv } from "../src/context.js";
import { loadConfig } from "../src/config/env.js";
import { buildIntegrations } from "../src/config/integrations.js";
import { buildVerifierRegistry } from "../src/config/verifier-registry.js";
import { assertChainIdsAtBoot } from "../src/config/boot-checks.js";
import { evmLedger, zcashLedger } from "./support/multichain-fakes.js";

const BOOTSTRAP = "test-bootstrap-key";
const EVM = "0x1111111111111111111111111111111111111111";
const SOL = "mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN";
const ZEC = "t1Ne88F8ouCV92brDXNBB47a85brvnEHE8g";

async function zcashApp(): Promise<Hono<AppEnv>> {
  process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
  const registry = buildVerifierRegistry(loadConfig({ ZCASH_ENABLED: "true" }), { fetch: zcashLedger().fetch });
  const ctx = await createContext();
  return createApp({ ...ctx, verifiers: registry.verifiers, zcash: registry.zcash });
}

async function call(app: Hono<AppEnv>, method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { authorization: `Bearer ${BOOTSTRAP}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as { data?: any; error?: { code: string; message: string } } };
}

async function session(app: Hono<AppEnv>, body: Record<string, unknown>) {
  const product = await call(app, "POST", "/v1/products", {
    merchantId: "mch_1", organizationId: "org_1", name: "Repo", description: "Source", type: "github_repo_access", deliveryMode: "github_invite",
  });
  const price = await call(app, "POST", `/v1/products/${product.json.data.id}/prices`, { amount: "25.00", interval: "one_time" });
  return call(app, "POST", "/v1/checkout-sessions", {
    merchantId: "mch_1", items: [{ priceId: price.json.data.id, productId: product.json.data.id, quantity: 1 }], ...body,
  });
}

describe("checkout session network bindings", () => {
  it("accepts several networks with per-network payTo and binds each", async () => {
    const app = await zcashApp();
    const res = await session(app, {
      payToAddress: EVM,
      network: "base",
      acceptedNetworks: ["base", "tempo", "solana", "zcash"],
      payToByNetwork: { solana: SOL, zcash: ZEC },
    });
    expect(res.status).toBe(201);
    expect(res.json.data.acceptedNetworks).toEqual(["base", "tempo", "solana", "zcash"]);
    expect(res.json.data.paymentReference).toBeDefined();
    expect(res.json.data.settlementQuote).toMatchObject({ asset: "ZEC", decimals: 8, rate: "1438.25", source: "coinbase" });
  });

  it("validates every accepted network's payTo and the network list", async () => {
    const app = await zcashApp();
    const badSolana = await session(app, { payToAddress: EVM, network: "base", acceptedNetworks: ["base", "solana"] });
    expect(badSolana.status).toBe(400);
    const missingPrimary = await session(app, { payToAddress: EVM, network: "base", acceptedNetworks: ["arbitrum"] });
    expect(missingPrimary.status).toBe(400);
    const stray = await session(app, { payToAddress: EVM, network: "base", payToByNetwork: { solana: SOL } });
    expect(stray.status).toBe(400);
    const zeroAddress = await session(app, { payToAddress: "0x0000000000000000000000000000000000000000", network: "arbitrum" });
    expect(zeroAddress.status).toBe(400);
    const shielded = await session(app, { payToAddress: "zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly", network: "zcash" });
    expect(shielded.status).toBe(400);
    expect(JSON.stringify(shielded.json.error)).toMatch(/shielded/);
  });

  it("gives concurrent Zcash sessions on one address distinct amounts", async () => {
    const app = await zcashApp();
    const amounts = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const res = await session(app, { payToAddress: ZEC, network: "zcash" });
      expect(res.status).toBe(201);
      const quote = res.json.data.settlementQuote;
      expect(BigInt(quote.amountBase) - usdToZats("25", quote.rate)).toBeLessThan(10_000n);
      amounts.add(quote.amountBase);
    }
    expect(amounts.size).toBe(5);
  });

  it("returns 502 when no ZEC price can be obtained", async () => {
    process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
    const down = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const registry = buildVerifierRegistry(loadConfig({ ZCASH_ENABLED: "true" }), { fetch: down });
    const app = createApp({ ...(await createContext()), verifiers: registry.verifiers, zcash: registry.zcash });
    const res = await session(app, { payToAddress: ZEC, network: "zcash" });
    expect(res.status).toBe(502);
    expect(res.json.error?.code).toBe("integration_error");
  });
});

describe("verifier registry", () => {
  it("registers exactly the enabled networks", () => {
    const { verifiers } = buildIntegrations(
      loadConfig({ ENABLED_EVM_CHAINS: "tempo,robinhood", ZCASH_ENABLED: "true", SOLANA_CLUSTER: "devnet" }),
    );
    expect(Object.keys(verifiers).sort()).toEqual(["robinhood", "solana", "tempo", "zcash"]);
  });

  it("exposes the zcash runtime only when enabled", () => {
    expect(buildIntegrations(loadConfig({})).zcash).toBeNull();
    expect(buildIntegrations(loadConfig({ ZCASH_ENABLED: "1" })).zcash).toMatchObject({ network: "mainnet", quoteTtlSec: 900, minConfirmations: 3 });
  });
});

describe("boot chain-id assertion", () => {
  const config = loadConfig({ ENABLED_EVM_CHAINS: "base", SETTLEKIT_CHAIN_ENV: "mainnet" });
  const logs: string[] = [];
  const log = (message: string) => logs.push(message);

  it("passes when every RPC serves its chain", async () => {
    const { evmVerifiers } = buildVerifierRegistry(config, { evmRpcs: { base: evmLedger(8453).rpc } });
    await expect(assertChainIdsAtBoot(evmVerifiers, log)).resolves.toBeUndefined();
  });

  it("refuses to boot on a chain-id mismatch", async () => {
    const { evmVerifiers } = buildVerifierRegistry(config, { evmRpcs: { base: evmLedger(84532).rpc } });
    await expect(assertChainIdsAtBoot(evmVerifiers, log)).rejects.toThrow(/Refusing to boot/);
  });

  it("only warns when an RPC is unreachable", async () => {
    const rpc = { ...evmLedger(8453).rpc, getChainId: async () => Promise.reject(new Error("ECONNREFUSED")) };
    const { evmVerifiers } = buildVerifierRegistry(config, { evmRpcs: { base: rpc } });
    await expect(assertChainIdsAtBoot(evmVerifiers, log)).resolves.toBeUndefined();
    expect(logs.some((line) => line.includes("unreachable"))).toBe(true);
  });
});

describe("loadConfig chain groups", () => {
  it("defaults to testnet with no chains and Zcash off", () => {
    const cfg = loadConfig({});
    expect(cfg.evm).toEqual({ env: "testnet", enabled: {}, notes: [] });
    expect(cfg.zcash).toBeNull();
    expect(cfg.hasZcash).toBe(false);
  });

  it("surfaces chain misconfiguration as a ConfigError", () => {
    expect(() => loadConfig({ ENABLED_EVM_CHAINS: "dogechain" })).toThrow(/unknown chain/);
    expect(() => loadConfig({ ENABLED_EVM_CHAINS: "base", BASE_TOKEN_ADDRESS: "0x1111111111111111111111111111111111111111", NODE_ENV: "production", DATABASE_URL: "postgres://x", LICENSE_TOKEN_SECRET: "a", WEBHOOK_SIGNING_SECRET: "b", AUTH_COOKIE_SECRET: "c" })).toThrow(/refused in production/);
  });
});
