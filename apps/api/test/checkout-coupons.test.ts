/**
 * Promo codes reach checkout through the API: session create (`couponCode`)
 * and payment-link visits (`promo`). The verifier expects the discounted
 * amount and the code is redeemed once the payment confirms.
 */
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { SettlementVerifier } from "@settlekit/chains";
import { createApp } from "../src/app.js";
import { createContext, type AppContext, type AppEnv } from "../src/context.js";

const BOOTSTRAP = "test-bootstrap-key";
const PAY_TO = "0x7777777777777777777777777777777777777777";

let app: Hono<AppEnv>;
let ctx: AppContext;
const verified: { amount: string }[] = [];

const recordingVerifier: SettlementVerifier = async (proof, requirements) => {
  verified.push({ amount: (requirements as unknown as { amount: string }).amount });
  return proof.network === requirements.network ? { ok: true } : { ok: false, reason: "network mismatch" };
};

async function call(method: string, path: string, body?: unknown, auth = true) {
  const res = await app.request(path, {
    method,
    headers: { ...(auth ? { authorization: `Bearer ${BOOTSTRAP}` } : {}), "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as { data?: any; error?: { code: string; message: string } } };
}

beforeEach(async () => {
  process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
  const base = await createContext();
  ctx = { ...base, verifiers: { ...base.verifiers, base: recordingVerifier } };
  app = createApp(ctx);
  verified.length = 0;
  expect((await call("POST", "/v1/coupons", { code: "launch20", discount: { type: "percent", percentOff: 20 }, maxRedemptions: 5 })).status).toBe(201);
});

async function catalogPrice(amount: string): Promise<{ productId: string; priceId: string }> {
  const product = await call("POST", "/v1/products", { merchantId: "mch_1", name: "Pro", type: "digital_download", deliveryMode: "file_download" });
  const price = await call("POST", `/v1/products/${product.json.data.id}/prices`, { amount });
  return { productId: product.json.data.id, priceId: price.json.data.id };
}

describe("coupons at checkout", () => {
  it("creates a discounted session, verifies the discounted amount and redeems on confirm", async () => {
    const { productId, priceId } = await catalogPrice("50");
    const customer = await call("POST", "/v1/customers", { email: "b@x.test" });
    const session = await call("POST", "/v1/checkout-sessions", {
      merchantId: "mch_1",
      customerId: customer.json.data.id,
      items: [{ priceId, productId, quantity: 2 }],
      payToAddress: PAY_TO,
      network: "base",
      couponCode: "LAUNCH20",
    });
    expect(session.status).toBe(201);
    expect(session.json.data.amount.amount).toBe("80");
    expect(session.json.data.discount).toMatchObject({ couponCode: "LAUNCH20", subtotal: { amount: "100" }, amountOff: { amount: "20" } });

    const payment = await call("POST", "/v1/payments", { checkoutSessionId: session.json.data.id });
    expect(payment.json.data.amount.amount).toBe("80");
    const confirmed = await call("POST", `/v1/payments/${payment.json.data.id}/confirm`, {
      txHash: `0x${randomBytes(32).toString("hex")}`,
      confirmations: 3,
    });
    expect(confirmed.status).toBe(200);
    expect(verified.at(-1)?.amount).toBe("80");
    expect((await call("GET", "/v1/coupons/LAUNCH20")).json.data.redeemedCount).toBe(1);
    const stored = await ctx.checkouts.findById(session.json.data.id);
    expect(stored?.discount?.redeemedAt).toBeDefined();
  });

  it("refuses an unknown code and leaves sessions without a code unchanged", async () => {
    const { productId, priceId } = await catalogPrice("50");
    const base = { merchantId: "mch_1", items: [{ priceId, productId, quantity: 1 }], payToAddress: PAY_TO, network: "base" };
    const bad = await call("POST", "/v1/checkout-sessions", { ...base, couponCode: "NOPE" });
    expect(bad.status).toBe(400);
    expect(bad.json.error?.message).toMatch(/not valid/);
    const plain = await call("POST", "/v1/checkout-sessions", base);
    expect(plain.json.data.amount.amount).toBe("50");
    expect(plain.json.data.discount).toBeUndefined();
  });

  it("applies ?promo= on a payment link visit", async () => {
    expect(
      (await call("POST", "/v1/merchant/profile", { orgName: "Shop", acceptedNetworks: ["base"], addresses: { evm: PAY_TO } })).status,
    ).toBe(200);
    const product = await call("POST", "/v1/merchant/products", {
      name: "Course",
      description: "Video course",
      priceUsd: "40",
      interval: "one_time",
      delivery: { kind: "license_key", machineLimit: 1 },
    });
    const slug = product.json.data.slug as string;
    const withPromo = await call("POST", `/v1/public/links/${slug}/sessions`, { promo: "launch20" }, false);
    expect(withPromo.status).toBe(201);
    expect((await ctx.checkouts.findById(withPromo.json.data.sessionId))?.amount.amount).toBe("32");
    const refused = await call("POST", `/v1/public/links/${slug}/sessions`, { promo: "WRONG" }, false);
    expect(refused.status).toBe(400);
    const full = await call("POST", `/v1/public/links/${slug}/sessions`, {}, false);
    expect((await ctx.checkouts.findById(full.json.data.sessionId))?.amount.amount).toBe("40");
  });
});
