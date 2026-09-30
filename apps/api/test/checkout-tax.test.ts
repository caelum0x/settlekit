/**
 * Checkout tax + tax-grade receipts: the seller's settings add tax on top of
 * the net price, the buyer's country / VAT ID pick the rate, onchain
 * verification expects the tax-inclusive total, and the receipt PDF is served
 * for the settled checkout.
 */
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { SettlementVerifier } from "@settlekit/chains";
import { createApp } from "../src/app.js";
import { createContext, type AppContext, type AppEnv } from "../src/context.js";

const BOOTSTRAP = "test-bootstrap-key";
const PAY_TO = "0x8888888888888888888888888888888888888888";

let app: Hono<AppEnv>;
let ctx: AppContext;
const verifiedAmounts: string[] = [];

const verifier: SettlementVerifier = async (proof, requirements) => {
  verifiedAmounts.push((requirements as unknown as { amount: string }).amount);
  return proof.network === requirements.network ? { ok: true } : { ok: false, reason: "network mismatch" };
};

async function call(method: string, path: string, body?: unknown, auth = true) {
  const res = await app.request(path, {
    method,
    headers: { ...(auth ? { authorization: `Bearer ${BOOTSTRAP}` } : {}), "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if ((res.headers.get("content-type") ?? "").includes("application/pdf")) {
    return { status: res.status, json: {} as { data?: any; error?: any }, pdf: Buffer.from(await res.arrayBuffer()) };
  }
  return { status: res.status, json: (await res.json()) as { data?: any; error?: { message: string } }, pdf: null };
}

const TAX = {
  enabled: true,
  label: "VAT",
  sellerCountry: "de",
  taxId: "DE123456789",
  legalName: "Acme Software GmbH",
  defaultRateBps: 0,
  rates: { DE: 1900, FR: 2000 },
  reverseCharge: true,
};

beforeEach(async () => {
  process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
  const base = await createContext();
  ctx = { ...base, verifiers: { ...base.verifiers, base: verifier } };
  app = createApp(ctx);
  verifiedAmounts.length = 0;
});

async function price(amount: string) {
  const product = await call("POST", "/v1/products", { merchantId: "mch_1", name: "Pro license", type: "license_key", deliveryMode: "license_key" });
  const p = await call("POST", `/v1/products/${product.json.data.id}/prices`, { amount });
  return { productId: product.json.data.id as string, priceId: p.json.data.id as string };
}

describe("checkout tax", () => {
  it("validates and stores tax settings", async () => {
    const saved = await call("POST", "/v1/settings", { tax: TAX });
    expect(saved.status).toBe(200);
    expect(saved.json.data.tax).toMatchObject({ enabled: true, sellerCountry: "DE", rates: { DE: 1900, FR: 2000 } });
    const bad = await call("POST", "/v1/settings", { tax: { ...TAX, rates: { France: 2000 } } });
    expect(bad.status).toBe(400);
  });

  it("charges the buyer's rate, verifies the taxed total and serves a tax-grade receipt", async () => {
    await call("POST", "/v1/settings", { tax: TAX });
    const { productId, priceId } = await price("100");
    const customer = await call("POST", "/v1/customers", { email: "ap@client.fr" });
    const base = { merchantId: "mch_1", customerId: customer.json.data.id, items: [{ priceId, productId, quantity: 1 }], payToAddress: PAY_TO, network: "base" };

    const domestic = await call("POST", "/v1/checkout-sessions", base);
    expect(domestic.json.data.amount.amount).toBe("119");
    expect(domestic.json.data.tax).toMatchObject({ rateBps: 1900, jurisdiction: "DE", amount: { amount: "19" }, net: { amount: "100" } });

    const b2b = await call("POST", "/v1/checkout-sessions", { ...base, billingCountry: "FR", vatId: "FR12345678901" });
    expect(b2b.json.data.amount.amount).toBe("100");
    expect(b2b.json.data.tax).toMatchObject({ reverseCharge: true, vatId: "FR12345678901" });

    const consumer = await call("POST", "/v1/checkout-sessions", { ...base, billingCountry: "FR", collectedFields: { email: "ap@client.fr" } });
    expect(consumer.json.data.amount.amount).toBe("120");
    const sessionId = consumer.json.data.id as string;

    // Receipt is only available once the checkout settled.
    expect((await call("GET", `/v1/public/receipts/${sessionId}/pdf`, undefined, false)).status).toBe(404);

    const payment = await call("POST", "/v1/payments", { checkoutSessionId: sessionId });
    await call("POST", `/v1/payments/${payment.json.data.id}/confirm`, { txHash: `0x${randomBytes(32).toString("hex")}`, confirmations: 3 });
    expect(verifiedAmounts.at(-1)).toBe("120");

    const receipt = await call("GET", `/v1/public/receipts/${sessionId}/pdf`, undefined, false);
    expect(receipt.status).toBe(200);
    expect(receipt.pdf?.subarray(0, 5).toString()).toBe("%PDF-");
    expect(receipt.pdf!.length).toBeGreaterThan(1500);
  });

  it("combines a promo with tax without compounding", async () => {
    await call("POST", "/v1/settings", { tax: TAX });
    await call("POST", "/v1/coupons", { code: "TEN", discount: { type: "amount", amountOff: "10" } });
    const { productId, priceId } = await price("100");
    const s = await call("POST", "/v1/checkout-sessions", {
      merchantId: "mch_1",
      items: [{ priceId, productId, quantity: 1 }],
      payToAddress: PAY_TO,
      network: "base",
      couponCode: "TEN",
    });
    expect(s.json.data.tax.net.amount).toBe("90");
    expect(s.json.data.amount.amount).toBe("107.1");
  });

  it("leaves checkout untaxed when the seller has no tax settings", async () => {
    const { productId, priceId } = await price("100");
    const s = await call("POST", "/v1/checkout-sessions", {
      merchantId: "mch_1",
      items: [{ priceId, productId, quantity: 1 }],
      payToAddress: PAY_TO,
      network: "base",
      billingCountry: "FR",
    });
    expect(s.json.data.amount.amount).toBe("100");
    expect(s.json.data.tax).toBeUndefined();
  });
});
