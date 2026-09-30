/** Merchant accounting exports: tenant-scoped CSVs incl. Xero / QuickBooks imports. */
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { SettlementVerifier } from "@settlekit/chains";
import { createApp } from "../src/app.js";
import { createContext, type AppContext, type AppEnv } from "../src/context.js";

const BOOTSTRAP = "test-bootstrap-key";
const PAY_TO = "0x9999999999999999999999999999999999999999";

let app: Hono<AppEnv>;
let ctx: AppContext;
let otherKey: string;

const verifier: SettlementVerifier = async (proof, req) =>
  proof.network === req.network ? { ok: true } : { ok: false, reason: "network mismatch" };

async function call(method: string, path: string, body?: unknown, key = BOOTSTRAP) {
  const res = await app.request(path, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const type = res.headers.get("content-type") ?? "";
  return {
    status: res.status,
    type,
    disposition: res.headers.get("content-disposition") ?? "",
    text: type.includes("text/csv") ? await res.text() : "",
    json: type.includes("json") ? ((await res.json()) as { data?: any; error?: { message: string } }) : {},
  };
}

beforeEach(async () => {
  process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
  const base = await createContext();
  ctx = { ...base, verifiers: { ...base.verifiers, base: verifier } };
  app = createApp(ctx);
  otherKey = (
    await ctx.apiKeys.issue({ organizationId: "org_other", customerId: "c", productId: "__platform__", entitlementId: "e", scopes: ["*"], env: "live" })
  ).plaintext;

  const product = await call("POST", "/v1/products", { merchantId: "mch_1", name: "=cmd|' /C calc'!A0", type: "license_key", deliveryMode: "license_key" });
  const price = await call("POST", `/v1/products/${product.json.data.id}/prices`, { amount: "25" });
  const customer = await call("POST", "/v1/customers", { email: "buyer@example.com" });
  const session = await call("POST", "/v1/checkout-sessions", {
    merchantId: "mch_1",
    customerId: customer.json.data.id,
    items: [{ priceId: price.json.data.id, productId: product.json.data.id, quantity: 1 }],
    payToAddress: PAY_TO,
    network: "base",
  });
  const payment = await call("POST", "/v1/payments", { checkoutSessionId: session.json.data.id });
  await call("POST", `/v1/payments/${payment.json.data.id}/confirm`, { txHash: `0x${randomBytes(32).toString("hex")}`, confirmations: 3 });
  const refund = await call("POST", "/v1/refunds", { paymentId: payment.json.data.id, customerId: customer.json.data.id, amount: "5", reason: "customer_request" });
  await call("POST", `/v1/refunds/${refund.json.data.id}/succeed`, { txHash: `0x${randomBytes(32).toString("hex")}` });
});

describe("accounting exports", () => {
  it("downloads payments as CSV with formula cells neutralized", async () => {
    const res = await call("GET", "/v1/exports/payments.csv");
    expect(res.status).toBe(200);
    expect(res.type).toContain("text/csv");
    expect(res.disposition).toMatch(/attachment; filename="settlekit-.*-payments\.csv"/);
    const [header, row] = res.text.split("\n");
    expect(header).toContain('"id","created_at","confirmed_at","status","amount"');
    expect(row).toContain('"confirmed","25","USDC","base"');
    expect(row).toContain('"buyer@example.com"');
    expect(row).toContain(`"'=cmd|' /C calc'!A0"`);
  });

  it("builds Xero and QuickBooks bank statements from payments and refunds", async () => {
    const xero = (await call("GET", "/v1/exports/xero.csv")).text.split("\n");
    expect(xero[0]).toBe('"*Date","*Amount","Payee","Description","Reference"');
    expect(xero).toHaveLength(3);
    expect(xero[1]).toContain('"25","buyer@example.com"');
    expect(xero.some((l) => l.includes('"-5"'))).toBe(true);
    const qb = (await call("GET", "/v1/exports/quickbooks.csv")).text.split("\n");
    expect(qb[0]).toBe('"Date","Description","Amount"');
    expect(qb).toHaveLength(3);
    expect((await call("GET", "/v1/exports/ledger.csv")).text).toContain('"refund","-5","USDC"');
  });

  it("filters by date and rejects malformed dates", async () => {
    const future = await call("GET", "/v1/exports/ledger.csv?from=2999-01-01");
    expect(future.text.split("\n")).toHaveLength(1);
    expect((await call("GET", "/v1/exports/ledger.csv?from=yesterday")).status).toBe(400);
  });

  it("exports refunds, invoices and payouts and never another tenant's data", async () => {
    expect((await call("GET", "/v1/exports/refunds.csv")).text.split("\n")).toHaveLength(2);
    expect((await call("GET", "/v1/exports/invoices.csv")).status).toBe(200);
    expect((await call("GET", "/v1/exports/payouts.csv")).status).toBe(200);
    const other = await call("GET", "/v1/exports/payments.csv", undefined, otherKey);
    expect(other.text.split("\n")).toHaveLength(1);
    expect((await call("GET", "/v1/exports/xero.csv", undefined, otherKey)).text.split("\n")).toHaveLength(1);
    expect((await call("GET", "/v1/exports/refunds.csv", undefined, otherKey)).text.split("\n")).toHaveLength(1);
  });
});
