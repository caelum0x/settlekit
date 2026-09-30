/**
 * Refund to payer: SettleKit prepares the transfer back to the buyer, the
 * merchant signs it, and the refund settles only after onchain verification.
 */
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { SettlementVerifier } from "@settlekit/chains";
import { parseSolanaPayUrl } from "@settlekit/solana";
import { createApp } from "../src/app.js";
import { createContext, type AppContext, type AppEnv } from "../src/context.js";
import { erc20TransferData } from "../src/merchant/refund-to-payer.js";

const BOOTSTRAP = "test-bootstrap-key";
const MERCHANT = "0x3434343434343434343434343434343434343434";
const BUYER = "0x5656565656565656565656565656565656565656";
const SOL_BUYER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

let app: Hono<AppEnv>;
let ctx: AppContext;
let verifyOk = true;
const checks: { payTo: string; amount: string; reference?: string }[] = [];

const verifier: SettlementVerifier = async (proof, req) => {
  const r = req as unknown as { payTo: string; amount: string; reference?: string };
  checks.push({ payTo: r.payTo, amount: r.amount, ...(r.reference ? { reference: r.reference } : {}) });
  if (proof.network !== req.network) return { ok: false, reason: "network mismatch" };
  return verifyOk ? { ok: true } : { ok: false, reason: "no matching transfer" };
};

const tx = () => `0x${randomBytes(32).toString("hex")}`;

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { authorization: `Bearer ${BOOTSTRAP}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as { data?: any; error?: { message: string } } };
}

beforeEach(async () => {
  process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
  verifyOk = true;
  checks.length = 0;
  const base = await createContext();
  ctx = { ...base, verifiers: { ...base.verifiers, base: verifier, solana: verifier } };
  app = createApp(ctx);
});

async function paidPayment(network: "base" | "solana", amount = "40", payer: string | null = BUYER): Promise<string> {
  const product = await call("POST", "/v1/products", { merchantId: "mch_1", name: "Course", type: "license_key", deliveryMode: "license_key" });
  const price = await call("POST", `/v1/products/${product.json.data.id}/prices`, { amount });
  const customer = await call("POST", "/v1/customers", { email: "buyer@x.test" });
  const session = await call("POST", "/v1/checkout-sessions", {
    merchantId: "mch_1",
    customerId: customer.json.data.id,
    items: [{ priceId: price.json.data.id, productId: product.json.data.id, quantity: 1 }],
    payToAddress: network === "base" ? MERCHANT : "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    network,
  });
  const stored = await ctx.checkouts.findById(session.json.data.id);
  if (payer) await ctx.checkouts.save({ ...stored!, payerAddress: payer });
  const payment = await call("POST", "/v1/payments", { checkoutSessionId: session.json.data.id });
  const hash = network === "base" ? tx() : "5".repeat(88);
  const confirmed = await call("POST", `/v1/payments/${payment.json.data.id}/confirm`, { txHash: hash, confirmations: 3 });
  expect(confirmed.status).toBe(200);
  checks.length = 0;
  return payment.json.data.id as string;
}

describe("refund to payer", () => {
  it("prepares an ERC-20 transfer to the paying wallet and settles after onchain verification", async () => {
    const paymentId = await paidPayment("base");
    const prepared = await call("POST", `/v1/merchant/payments/${paymentId}/refund/prepare`, { amountUsd: "15" });
    expect(prepared.status).toBe(201);
    const { refund, plan } = prepared.json.data;
    expect(refund).toMatchObject({ status: "pending", destination: BUYER, network: "base", source: "wallet" });
    expect(plan.evm.data).toBe(erc20TransferData(BUYER, 15_000_000n));
    expect(plan.evm.eip681).toContain(`/transfer?address=${BUYER}&uint256=15000000`);

    verifyOk = false;
    const failed = await call("POST", `/v1/merchant/refunds/${refund.id}/confirm`, { txHash: tx() });
    expect(failed.status).toBe(400);
    expect((await ctx.refundStore.findById(refund.id))?.status).toBe("pending");

    verifyOk = true;
    const hash = tx();
    const done = await call("POST", `/v1/merchant/refunds/${refund.id}/confirm`, { txHash: hash });
    expect(done.status).toBe(200);
    expect(done.json.data.refund).toMatchObject({ status: "succeeded", txHash: hash });
    expect(checks.at(-1)).toMatchObject({ payTo: BUYER, amount: "15" });
    // Partial refund: the payment stays confirmed.
    expect((await ctx.payments.findById(paymentId))?.status).toBe("confirmed");

    // The same transaction cannot settle a second refund.
    const second = (await call("POST", `/v1/merchant/payments/${paymentId}/refund/prepare`, {})).json.data.refund;
    expect(second.amount.amount).toBe("25");
    expect((await call("POST", `/v1/merchant/refunds/${second.id}/confirm`, { txHash: hash })).status).toBe(409);
    const rest = await call("POST", `/v1/merchant/refunds/${second.id}/confirm`, { txHash: tx() });
    expect(rest.status).toBe(200);
    expect((await ctx.payments.findById(paymentId))?.status).toBe("refunded");
  });

  it("prepares a Solana Pay transfer request bound to a reference", async () => {
    const paymentId = await paidPayment("solana", "12", SOL_BUYER);
    const prepared = await call("POST", `/v1/merchant/payments/${paymentId}/refund/prepare`, {});
    const { refund, plan } = prepared.json.data;
    const parsed = parseSolanaPayUrl(plan.solana.url) as { recipient: string; amount?: string; references?: string[] };
    expect(parsed.recipient).toBe(SOL_BUYER);
    expect(parsed.amount).toBe("12");
    expect(parsed.references).toEqual([plan.solana.reference]);
    const done = await call("POST", `/v1/merchant/refunds/${refund.id}/confirm`, { txHash: "4".repeat(88) });
    expect(done.status).toBe(200);
    expect(checks.at(-1)).toMatchObject({ payTo: SOL_BUYER, reference: plan.solana.reference });
  });

  it("asks for an address when the payer is unknown and validates it", async () => {
    const paymentId = await paidPayment("base", "10", null);
    const missing = await call("POST", `/v1/merchant/payments/${paymentId}/refund/prepare`, {});
    expect(missing.status).toBe(400);
    expect(missing.json.error?.message).toMatch(/enter the address/);
    expect((await call("POST", `/v1/merchant/payments/${paymentId}/refund/prepare`, { to: "not-an-address" })).status).toBe(400);
    const ok = await call("POST", `/v1/merchant/payments/${paymentId}/refund/prepare`, { to: BUYER });
    expect(ok.status).toBe(201);
    const canceled = await call("POST", `/v1/merchant/refunds/${ok.json.data.refund.id}/cancel`);
    expect(canceled.json.data.status).toBe("failed");
    // Canceled refunds free the amount again.
    expect((await call("POST", `/v1/merchant/payments/${paymentId}/refund/prepare`, { to: BUYER })).json.data.refund.amount.amount).toBe("10");
  });
});
