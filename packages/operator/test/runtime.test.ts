import type { ScreeningClient } from "@settlekit/compliance";
import type { Settler } from "@settlekit/x402-client";
import { describe, expect, it } from "vitest";
import { createOperatorRuntime } from "../src/runtime.js";
import { OperatorConfigError, defaultPolicy, loadOperatorConfig } from "../src/runtime-config.js";
import { createCounterpartyScreener } from "../src/screening.js";
import { InMemoryOperatorStore } from "../src/store.js";
import { createX402Gateway, X402Error } from "../src/x402.js";
import { T0, VENDOR } from "./fixtures.js";
import { revenue, usdc } from "./harness.js";

const KEY = `0x${"1".repeat(64)}`;
const VAULT = "0x00000000000000000000000000000000000000f1";

describe("loadOperatorConfig", () => {
  it("uses Arc testnet defaults and the deploy-script caps", () => {
    const config = loadOperatorConfig({}, "org_default");
    expect(config).toMatchObject({ orgId: "org_default", chainId: 5_042_002, rpcUrl: "https://rpc.testnet.arc.network" });
    expect(config.vault).toBeUndefined();
    expect(config.defaults).toMatchObject({ perTxCap: usdc(1000), dailyCap: usdc(1500), escalateAbove: usdc(500), taxRateBps: 2500 });
  });

  it("picks DCW when Circle credentials are present, viem otherwise", () => {
    const dcw = loadOperatorConfig({ OPERATOR_VAULT_ADDRESS: VAULT, CIRCLE_API_KEY: "k", CIRCLE_ENTITY_SECRET: "a".repeat(64), OPERATOR_WALLET_ADDRESS: VENDOR, OWNER_PRIVATE_KEY: KEY }, "o");
    expect(dcw.vault?.operator).toEqual({ kind: "dcw", walletAddress: VENDOR });
    expect(dcw.vault?.owner).toEqual({ kind: "viem", privateKey: KEY });
    const viem = loadOperatorConfig({ OPERATOR_VAULT_ADDRESS: VAULT, OPERATOR_PRIVATE_KEY: KEY }, "o");
    expect(viem.vault?.operator.kind).toBe("viem");
    const forced = loadOperatorConfig({ OPERATOR_VAULT_ADDRESS: VAULT, CIRCLE_API_KEY: "k", CIRCLE_ENTITY_SECRET: "a".repeat(64), OPERATOR_WALLET_ADDRESS: VENDOR, OPERATOR_PRIVATE_KEY: KEY, OPERATOR_SIGNER: "viem" }, "o");
    expect(forced.vault?.operator.kind).toBe("viem");
  });

  it("fails fast on partial or malformed configuration", () => {
    expect(() => loadOperatorConfig({ OPERATOR_VAULT_ADDRESS: VAULT }, "o")).toThrow(OperatorConfigError);
    expect(() => loadOperatorConfig({ OPERATOR_VAULT_ADDRESS: "0x12" }, "o")).toThrow(/0x address/);
    expect(() => loadOperatorConfig({ OPERATOR_VAULT_ADDRESS: VAULT, OPERATOR_PRIVATE_KEY: "0xabc" }, "o")).toThrow(/32-byte/);
    expect(() => defaultPolicy({ OPERATOR_SPLIT_YIELD_BPS: "9000" })).toThrow(/10000/);
    expect(() => defaultPolicy({ OPERATOR_ALLOWLIST: "bob" })).toThrow(/not an address/);
    expect(defaultPolicy({ OPERATOR_ALLOWLIST: `${VENDOR.toUpperCase().replace("0X", "0x")}` }).allowlist).toEqual([VENDOR]);
  });
});

describe("createOperatorRuntime", () => {
  it("runs locally with the heuristic engine and labels the executor honestly", async () => {
    const runtime = createOperatorRuntime({ OPERATOR_ALLOWLIST: VENDOR }, "org_1", { now: () => T0 });
    expect(runtime.executorKind).toBe("local-simulation");
    expect(runtime.engineName).toBe("heuristic");
    const record = await runtime.service.handle(revenue(usdc(10)));
    expect(record.outcome).toBe("deferred");
    expect((await runtime.proof()).decisions.total).toBe(1);
    const verification = await runtime.verify(record.id);
    expect(verification).toMatchObject({ valid: true, onChain: "not_configured" });
    expect(await runtime.verify("nope")).toBeNull();
    expect((await runtime.policy.get("org_1")).allowlist).toEqual([VENDOR]);
  });

  it("builds real vault executors when a vault is configured", () => {
    const runtime = createOperatorRuntime({ OPERATOR_VAULT_ADDRESS: VAULT, OPERATOR_PRIVATE_KEY: KEY, OWNER_PRIVATE_KEY: KEY, ANTHROPIC_API_KEY: "sk-test" }, "org_1", { store: new InMemoryOperatorStore() });
    expect(runtime.executorKind).toBe("viem-signer");
    expect(runtime.engineName).toBe("claude+heuristic");
    const dcw = createOperatorRuntime({ OPERATOR_VAULT_ADDRESS: VAULT, CIRCLE_API_KEY: "k", CIRCLE_ENTITY_SECRET: "a".repeat(64), OPERATOR_WALLET_ADDRESS: VENDOR }, "org_1");
    expect(dcw.executorKind).toBe("circle-dcw");
  });
});

describe("counterparty screening", () => {
  it("combines risk rules with Circle screening and treats outages as review", async () => {
    const denied: ScreeningClient = { screenAddress: async (i) => ({ address: i.address, chain: i.chain, result: "DENIED", riskSignals: [], raw: {} }) };
    const a = await createCounterpartyScreener({ screening: denied, idempotencyKey: () => "k" }).assess("o", VENDOR, 1n, T0);
    expect(a).toMatchObject({ risk: "allow", screening: "circle", screeningResult: "DENIED", complianceSignals: [{ type: "sanctions_match", severity: "high" }] });
    const down: ScreeningClient = { screenAddress: async () => { throw new Error("503"); } };
    const b = await createCounterpartyScreener({ screening: down }).assess("o", VENDOR, 1n, T0);
    expect(b).toMatchObject({ screening: "unavailable", complianceSignals: [{ type: "wallet_risk", severity: "medium" }] });
    expect((await createCounterpartyScreener().assess("o", VENDOR, 0n, T0)).screening).toBe("not_configured");
  });
});

describe("x402 gateway", () => {
  const challenge = { accepts: [{ scheme: "exact", amount: "0.02", asset: "USDC", network: "arc-testnet", payTo: VENDOR, productId: "p", resource: "https://svc.example/data", nonce: "n1" }] };
  const settler: Settler = { settle: async ({ requirements }) => ({ txHash: "0xpaid", from: "0xme", amount: requirements.amount, network: requirements.network, nonce: requirements.nonce }) };
  const fetcher = async (req: Request): Promise<Response> =>
    req.headers.has("x-payment")
      ? new Response("the data", { status: 200 })
      : new Response(JSON.stringify(challenge), { status: 402, headers: { "content-type": "application/json" } });

  it("quotes, buys under a cap and counts today's purchases from the log", async () => {
    const store = new InMemoryOperatorStore();
    const gateway = createX402Gateway({ settler, from: "0xme", store, fetcher, allowedHosts: ["svc.example"] });
    const q = await gateway.quote("https://svc.example/data");
    expect(q).toMatchObject({ price: 20_000n, payTo: VENDOR });
    const bought = await gateway.buy("https://svc.example/data", 20_000n, VENDOR);
    expect(bought).toMatchObject({ txHash: "0xpaid", status: 200, body: "the data" });
    await expect(gateway.buy("https://svc.example/data", 10_000n, VENDOR)).rejects.toThrow(/exceeds cap/);
    await expect(gateway.buy("https://svc.example/data", 20_000n, "0x0000000000000000000000000000000000000bad")).rejects.toThrow(/payee changed/);
    expect(await gateway.purchasesToday("org_1", T0)).toBe(0);
  });

  it("never settles a challenge whose payee switched after the policy check", async () => {
    let calls = 0;
    const switching = async (req: Request): Promise<Response> => {
      if (req.headers.has("x-payment")) return new Response("the data", { status: 200 });
      calls += 1;
      const payTo = calls === 1 ? VENDOR : "0x0000000000000000000000000000000000000bad";
      return new Response(JSON.stringify({ accepts: [{ ...challenge.accepts[0], payTo }] }), { status: 402 });
    };
    const paid: string[] = [];
    const spy: Settler = { settle: async (r) => { paid.push(r.requirements.payTo); return settler.settle(r); } };
    const gateway = createX402Gateway({ settler: spy, from: "0xme", store: new InMemoryOperatorStore(), fetcher: switching });
    await expect(gateway.buy("https://svc.example/data", 20_000n, VENDOR)).rejects.toThrow(/approved payee/);
    expect(paid).toEqual([]);
  });

  it("refuses non-https, unlisted hosts and non-402 services", async () => {
    const store = new InMemoryOperatorStore();
    const gateway = createX402Gateway({ settler, from: "0xme", store, fetcher, allowedHosts: ["svc.example"] });
    await expect(gateway.quote("http://svc.example/data")).rejects.toBeInstanceOf(X402Error);
    await expect(gateway.quote("https://169.254.169.254/latest")).rejects.toThrow(/allowlist/);
    await expect(gateway.quote("not a url")).rejects.toThrow(/invalid url/);
    const free = createX402Gateway({ settler, from: "0xme", store, fetcher: async () => new Response("ok") });
    await expect(free.quote("https://any.example")).rejects.toThrow(/not a 402/);
  });
});
