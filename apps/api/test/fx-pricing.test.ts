/**
 * Fiat pricing: prices set in EUR/GBP settle in USDC at a live rate
 * (frankfurter, ECB) locked on each checkout session.
 */
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { SettlementVerifier } from "@settlekit/chains";
import { createApp } from "../src/app.js";
import { createContext, type AppContext, type AppEnv } from "../src/context.js";
import { createFrankfurterSource, type FxRateSource } from "../src/fx/rates.js";

const BOOTSTRAP = "test-bootstrap-key";
const PAY_TO = "0x1212121212121212121212121212121212121212";

let app: Hono<AppEnv>;
let ctx: AppContext;
let eurRate = "1.0834";
const verified: string[] = [];

const fakeRates: FxRateSource = {
  async usdPer(currency) {
    if (currency === "USD") return { rate: "1", date: "2026-09-29", source: "USDC par" };
    if (currency === "EUR") return { rate: eurRate, date: "2026-09-29", source: "ECB via frankfurter" };
    if (currency === "GBP") return { rate: "1.27", date: "2026-09-29", source: "ECB via frankfurter" };
    throw new Error("unexpected currency");
  },
};

const verifier: SettlementVerifier = async (proof, req) => {
  verified.push((req as unknown as { amount: string }).amount);
  return proof.network === req.network ? { ok: true } : { ok: false, reason: "network mismatch" };
};

async function call(method: string, path: string, body?: unknown, auth = true) {
  const res = await app.request(path, {
    method,
    headers: { ...(auth ? { authorization: `Bearer ${BOOTSTRAP}` } : {}), "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as { data?: any; error?: { message: string } } };
}

beforeEach(async () => {
  process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
  eurRate = "1.0834";
  verified.length = 0;
  const base = await createContext();
  ctx = { ...base, fxRates: fakeRates, verifiers: { ...base.verifiers, base: verifier } };
  app = createApp(ctx);
});

async function eurProduct(displayAmount = "29") {
  const product = await call("POST", "/v1/products", { merchantId: "mch_1", name: "Kurs", type: "license_key", deliveryMode: "license_key" });
  const price = await call("POST", `/v1/products/${product.json.data.id}/prices`, { displayCurrency: "EUR", displayAmount });
  return { productId: product.json.data.id as string, price: price };
}

describe("frankfurter rate source", () => {
  it("parses, caches and sanity-checks rates", async () => {
    let calls = 0;
    let t = 0;
    const source = createFrankfurterSource({
      baseUrl: "https://fx.test/v1/",
      now: () => t,
      fetch: (async (url: string) => {
        calls += 1;
        expect(url).toBe("https://fx.test/v1/latest?base=EUR&symbols=USD");
        return new Response(JSON.stringify({ amount: 1, base: "EUR", date: "2026-09-29", rates: { USD: 1.0834 } }));
      }) as unknown as typeof fetch,
    });
    expect(await source.usdPer("EUR")).toEqual({ rate: "1.0834", date: "2026-09-29", source: "ECB via frankfurter" });
    await source.usdPer("EUR");
    expect(calls).toBe(1);
    t = 600_001;
    await source.usdPer("EUR");
    expect(calls).toBe(2);
    expect((await source.usdPer("USD")).rate).toBe("1");
  });

  it("fails closed on errors and implausible rates", async () => {
    const down = createFrankfurterSource({ fetch: (async () => new Response("", { status: 502 })) as unknown as typeof fetch });
    await expect(down.usdPer("EUR")).rejects.toMatchObject({ code: "integration_error" });
    const junk = createFrankfurterSource({
      fetch: (async () => new Response(JSON.stringify({ date: "2026-09-29", rates: { USD: 0 } }))) as unknown as typeof fetch,
    });
    await expect(junk.usdPer("GBP")).rejects.toThrow(/temporarily unavailable/);
    const offline = createFrankfurterSource({
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    await expect(offline.usdPer("EUR")).rejects.toThrow(/unreachable/);
  });
});

describe("fiat-priced checkout", () => {
  it("stores a EUR price with a USDC reference and refuses fiat subscriptions", async () => {
    const { price, productId } = await eurProduct("29");
    expect(price.status).toBe(201);
    expect(price.json.data).toMatchObject({ displayCurrency: "EUR", displayAmount: "29", amount: "31.42", currency: "USDC" });
    const sub = await call("POST", `/v1/products/${productId}/prices`, { displayCurrency: "EUR", displayAmount: "9", interval: "monthly" });
    expect(sub.status).toBe(400);
    const half = await call("POST", `/v1/products/${productId}/prices`, { displayCurrency: "EUR" });
    expect(half.status).toBe(400);
  });

  it("locks today's rate on the session and verifies the converted USDC amount", async () => {
    const { price, productId } = await eurProduct("29");
    eurRate = "1.1"; // the rate moved since the price was created
    const session = await call("POST", "/v1/checkout-sessions", {
      merchantId: "mch_1",
      items: [{ priceId: price.json.data.id, productId, quantity: 2 }],
      payToAddress: PAY_TO,
      network: "base",
      customerId: (await call("POST", "/v1/customers", { email: "k@x.test" })).json.data.id,
    });
    expect(session.status).toBe(201);
    expect(session.json.data.amount.amount).toBe("63.8");
    expect(session.json.data.fxQuote).toMatchObject({ currency: "EUR", amount: "58", rate: "1.1", usdcAmount: "63.8", rateDate: "2026-09-29" });
    expect(session.json.data.fxQuote.expiresAt).toBe(session.json.data.expiresAt);

    const payment = await call("POST", "/v1/payments", { checkoutSessionId: session.json.data.id });
    await call("POST", `/v1/payments/${payment.json.data.id}/confirm`, { txHash: `0x${randomBytes(32).toString("hex")}`, confirmations: 3 });
    expect(verified.at(-1)).toBe("63.8");
  });

  it("refuses mixing two fiat currencies in one checkout", async () => {
    const eur = await eurProduct("10");
    const gbpProduct = await call("POST", "/v1/products", { merchantId: "mch_1", name: "UK", type: "license_key", deliveryMode: "license_key" });
    const gbp = await call("POST", `/v1/products/${gbpProduct.json.data.id}/prices`, { displayCurrency: "GBP", displayAmount: "10" });
    const res = await call("POST", "/v1/checkout-sessions", {
      merchantId: "mch_1",
      items: [
        { priceId: eur.price.json.data.id, productId: eur.productId, quantity: 1 },
        { priceId: gbp.json.data.id, productId: gbpProduct.json.data.id, quantity: 1 },
      ],
      payToAddress: PAY_TO,
      network: "base",
    });
    expect(res.status).toBe(400);
  });

  it("prices a quick product in EUR, shows it on the link and discounts the converted amount", async () => {
    await call("POST", "/v1/merchant/profile", { orgName: "Shop", acceptedNetworks: ["base"], addresses: { evm: PAY_TO } });
    await call("POST", "/v1/coupons", { code: "HALF", discount: { type: "percent", percentOff: 50 } });
    const product = await call("POST", "/v1/merchant/products", {
      name: "Kurs",
      priceUsd: "29",
      currency: "EUR",
      delivery: { kind: "license_key", machineLimit: 1 },
    });
    expect(product.status).toBe(201);
    expect(product.json.data).toMatchObject({ displayCurrency: "EUR", displayAmount: "29" });
    const slug = product.json.data.slug as string;

    eurRate = "1.2";
    const summary = await call("GET", `/v1/public/links/${slug}`, undefined, false);
    expect(summary.json.data).toMatchObject({ displayCurrency: "EUR", displayAmount: "29", priceUsd: "34.8" });

    const opened = await call("POST", `/v1/public/links/${slug}/sessions`, { promo: "HALF" }, false);
    const session = await ctx.checkouts.findById(opened.json.data.sessionId);
    expect(session?.fxQuote).toMatchObject({ currency: "EUR", rate: "1.2" });
    expect(session?.amount.amount).toBe("17.4");

    // Editing the price keeps the currency.
    const patched = await call("PATCH", `/v1/merchant/products/${product.json.data.id}`, { priceUsd: "39" });
    expect(patched.json.data).toMatchObject({ displayCurrency: "EUR", displayAmount: "39", priceUsd: "46.8" });

    const monthly = await call("POST", "/v1/merchant/products", {
      name: "Sub",
      priceUsd: "9",
      currency: "EUR",
      interval: "monthly",
      delivery: { kind: "license_key", machineLimit: 1 },
    });
    expect(monthly.status).toBe(400);
  });
});
