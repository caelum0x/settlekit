/**
 * Multi-chain checkout confirmation through the real routes and the REAL
 * verifier registry (buildVerifierRegistry), with chain access replaced by
 * in-memory ledgers. For every PaymentNetwork:
 *   - disabled            -> confirm fails closed (Zcash: no session can lock a quote)
 *   - enabled + chain pays -> confirmed, entitlement granted
 *   - same tx for another session -> 409
 *   - payTo from another chain family -> 400
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { Hex } from "@settlekit/arc";
import { PAYMENT_NETWORKS, type PaymentNetwork } from "@settlekit/common";
import { EVM_CHAIN_KEYS, isEvmChainKey, type EvmChainKey } from "@settlekit/chains";
import { base58Encode } from "@settlekit/zcash";
import { createApp } from "../src/app.js";
import { createContext, type AppEnv } from "../src/context.js";
import { loadConfig } from "../src/config/env.js";
import { buildVerifierRegistry } from "../src/config/verifier-registry.js";
import { evmLedger, hyperCoreLedger, solanaLedger, zcashLedger, type EvmLedger } from "./support/multichain-fakes.js";

const BOOTSTRAP = "test-bootstrap-key";
const EVM_MERCHANT = "0x1111111111111111111111111111111111111111" as Hex;
const EVM_BUYER = "0x2222222222222222222222222222222222222222" as Hex;
const SOL_MERCHANT = "mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN";
const SOL_BUYER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const ZEC_MERCHANT = "t1Ne88F8ouCV92brDXNBB47a85brvnEHE8g";

const PAY_TO: Record<"evm" | "solana" | "zcash", string> = { evm: EVM_MERCHANT, solana: SOL_MERCHANT, zcash: ZEC_MERCHANT };
const family = (network: PaymentNetwork) => (network === "solana" || network === "zcash" ? network : "evm");

const ENABLED_ENV = {
  SETTLEKIT_CHAIN_ENV: "mainnet",
  ENABLED_EVM_CHAINS: EVM_CHAIN_KEYS.join(","),
  SOLANA_CLUSTER: "mainnet",
  ZCASH_ENABLED: "true",
  HYPERCORE_ENABLED: "true",
};

interface Json {
  data?: any;
  error?: { code: string; message: string };
}

interface Harness {
  app: Hono<AppEnv>;
  /** Make the chain show a payment for `session` under `txHash`. */
  pay(network: PaymentNetwork, session: any, txHash: string): void;
}

async function harness(env: Record<string, string>): Promise<Harness> {
  process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
  const config = loadConfig(env);
  const evm: Partial<Record<EvmChainKey, EvmLedger>> = {};
  for (const chain of Object.values(config.evm.enabled)) {
    if (chain) evm[chain.key] = evmLedger(chain.spec.chainId);
  }
  const solana = solanaLedger();
  const zcash = zcashLedger();
  const hypercore = hyperCoreLedger();
  const registry = buildVerifierRegistry(config, {
    hypercoreTransport: hypercore.transport,
    evmRpcs: Object.fromEntries(Object.entries(evm).map(([key, ledger]) => [key, ledger!.rpc])),
    solanaRpc: solana.rpc,
    fetch: zcash.fetch,
  });
  const ctx = await createContext();
  const app = createApp({ ...ctx, verifiers: registry.verifiers, zcash: registry.zcash, evmVerifiers: registry.evmVerifiers });
  return {
    app,
    pay(network, session, txHash) {
      if (network === "solana") {
        solana.pay({ signature: txHash, payer: SOL_BUYER, merchant: SOL_MERCHANT, reference: session.paymentReference, amountBase: 25_000_000n });
      } else if (network === "hypercore") {
        hypercore.pay({ hash: txHash, from: EVM_BUYER, to: EVM_MERCHANT, usdc: "25.0" });
      } else if (network === "zcash") {
        zcash.pay({ txid: txHash, payTo: ZEC_MERCHANT, zats: BigInt(session.settlementQuote.amountBase) });
      } else if (isEvmChainKey(network)) {
        const chain = config.evm.enabled[network]!;
        evm[network]!.pay({ txHash: txHash as Hex, token: chain.tokenAddress, from: EVM_BUYER, to: EVM_MERCHANT, amountBase: 25_000_000n });
      }
    },
  };
}

async function call(app: Hono<AppEnv>, method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { authorization: `Bearer ${BOOTSTRAP}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

function txHashFor(network: PaymentNetwork): string {
  if (network === "solana") return base58Encode(randomBytes(64));
  const hex = randomBytes(32).toString("hex");
  return network === "zcash" ? hex : `0x${hex}`;
}

async function catalog(app: Hono<AppEnv>) {
  const product = await call(app, "POST", "/v1/products", {
    merchantId: "mch_1", organizationId: "org_1", name: "Repo", description: "Source", type: "github_repo_access", deliveryMode: "github_invite",
  });
  const productId = product.json.data.id as string;
  const price = await call(app, "POST", `/v1/products/${productId}/prices`, { amount: "25.00", interval: "one_time" });
  const customer = await call(app, "POST", "/v1/customers", { organizationId: "org_1", email: "buyer@example.com" });
  return { productId, priceId: price.json.data.id as string, customerId: customer.json.data.id as string };
}

async function openSession(app: Hono<AppEnv>, network: PaymentNetwork, payToAddress = PAY_TO[family(network)]) {
  const { productId, priceId, customerId } = await catalog(app);
  const checkout = await call(app, "POST", "/v1/checkout-sessions", {
    merchantId: "mch_1", customerId, items: [{ priceId, productId, quantity: 1 }], payToAddress, network,
  });
  if (checkout.status !== 201) return { checkout, productId, customerId };
  const payment = await call(app, "POST", "/v1/payments", { checkoutSessionId: checkout.json.data.id });
  expect(payment.status).toBe(201);
  return { checkout, productId, customerId, session: checkout.json.data, paymentId: payment.json.data.id as string };
}

describe.each([...PAYMENT_NETWORKS])("network %s", (network) => {
  it("fails closed when the network is not enabled", async () => {
    const { app } = await harness({});
    const opened = await openSession(app, network);
    if (network === "zcash") {
      expect(opened.checkout.status).toBe(400);
      expect(opened.checkout.json.error?.message).toMatch(/zcash payments are not enabled/);
      return;
    }
    const res = await call(app, "POST", `/v1/payments/${opened.paymentId}/confirm`, { txHash: txHashFor(network), confirmations: 50 });
    expect(res.status).toBe(400);
    expect(res.json.error?.message).toMatch(new RegExp(`not configured for network "${network}"`));
    const access = await call(app, "POST", "/v1/entitlements/verify", { customerId: opened.customerId, productId: opened.productId });
    expect(access.json.data.allowed).toBe(false);
  });

  it("confirms a payment the chain shows and grants access", async () => {
    const h = await harness(ENABLED_ENV);
    const opened = await openSession(h.app, network);
    expect(opened.checkout.status).toBe(201);
    const txHash = txHashFor(network);
    h.pay(network, opened.session, txHash);
    const res = await call(h.app, "POST", `/v1/payments/${opened.paymentId}/confirm`, { txHash, confirmations: 1 });
    expect(res.status, JSON.stringify(res.json.error)).toBe(200);
    expect(res.json.data.payment).toMatchObject({ status: "confirmed", network });
    expect(res.json.data.entitlements).toHaveLength(1);
  });

  it("rejects a transaction the chain does not show", async () => {
    const h = await harness(ENABLED_ENV);
    const opened = await openSession(h.app, network);
    const res = await call(h.app, "POST", `/v1/payments/${opened.paymentId}/confirm`, { txHash: txHashFor(network), confirmations: 1 });
    expect(res.status).toBe(400);
    expect((await call(h.app, "GET", `/v1/payments/${opened.paymentId}`)).json.data.status).toBe("pending");
  });

  it("returns 409 when the same transaction is claimed for another session", async () => {
    const h = await harness(ENABLED_ENV);
    const first = await openSession(h.app, network);
    const second = await openSession(h.app, network);
    const txHash = txHashFor(network);
    h.pay(network, first.session, txHash);
    expect((await call(h.app, "POST", `/v1/payments/${first.paymentId}/confirm`, { txHash, confirmations: 1 })).status).toBe(200);
    const replay = await call(h.app, "POST", `/v1/payments/${second.paymentId}/confirm`, { txHash, confirmations: 1 });
    expect(replay.status).toBe(409);
    expect(replay.json.error?.code).toBe("conflict");
  });

  it("rejects a payTo from another chain family with 400", async () => {
    const h = await harness(ENABLED_ENV);
    const wrong = family(network) === "evm" ? SOL_MERCHANT : EVM_MERCHANT;
    const opened = await openSession(h.app, network, wrong);
    expect(opened.checkout.status).toBe(400);
    expect(opened.checkout.json.error?.code).toBe("validation_error");
  });

  it("rejects a malformed tx id for the network with 400", async () => {
    const h = await harness(ENABLED_ENV);
    const opened = await openSession(h.app, network);
    const res = await call(h.app, "POST", `/v1/payments/${opened.paymentId}/confirm`, { txHash: "0xdeadbeef", confirmations: 1 });
    expect(res.status).toBe(400);
    expect(res.json.error?.message).toMatch(/txHash must be/);
  });
});
