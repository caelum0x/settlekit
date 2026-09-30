/**
 * SettleKit's own revenue: monthly fee statements issued from the platform org,
 * paid through SettleKit's own checkout, with the free plan's product limit
 * applied after the grace period.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { money, type Payment } from "@settlekit/common";
import type { SettlementVerifier } from "@settlekit/chains";
import { DEFAULT_ORG_ID } from "@settlekit/persistence";
import { createApp } from "../src/app.js";
import { createContext, type AppContext, type AppEnv } from "../src/context.js";
import { issueStatement, loadPlatformBillingConfig, runStatements } from "../src/platform/fee-statements.js";

const BOOTSTRAP = "test-bootstrap-key";
const PLATFORM_ORG = "org_platform";
const PLATFORM_WALLET = "0x5555555555555555555555555555555555555555";
const MERCHANT_WALLET = "0x6666666666666666666666666666666666666666";

const baseChainDouble: SettlementVerifier = async (proof, requirements) =>
  proof.network === requirements.network ? { ok: true } : { ok: false, reason: "network mismatch" };

let app: Hono<AppEnv>;
let ctx: AppContext;
let platformKey: string;
let otherKey: string;

async function callAs(key: string, method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as { data?: any; error?: { code: string; message: string } } };
}

const merchant = (method: string, path: string, body?: unknown) => callAs(BOOTSTRAP, method, path, body);
const platform = (method: string, path: string, body?: unknown) => callAs(platformKey, method, path, body);

let paySeq = 0;
async function settledPayment(amount: string, confirmedAt: string, organizationId = DEFAULT_ORG_ID): Promise<void> {
  paySeq += 1;
  const payment: Payment = {
    id: `pay_fee_${paySeq}`,
    organizationId,
    checkoutSessionId: `cs_fee_${paySeq}`,
    customerId: "cus_buyer",
    amount: money(amount),
    network: "base",
    txHash: `0x${randomBytes(32).toString("hex")}`,
    confirmations: 3,
    status: "confirmed",
    createdAt: confirmedAt,
    confirmedAt,
  };
  await ctx.payments.save(payment);
}

async function quickProduct(name: string) {
  return merchant("POST", "/v1/merchant/products", {
    name,
    description: `${name} description`,
    priceUsd: "10",
    interval: "one_time",
    delivery: { kind: "license_key", machineLimit: 1 },
  });
}

beforeEach(async () => {
  process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
  process.env.PLATFORM_BILLING_ORG_ID = PLATFORM_ORG;
  process.env.PLATFORM_BILLING_DUE_DAYS = "14";
  process.env.PLATFORM_BILLING_GRACE_DAYS = "7";
  process.env.PLATFORM_BILLING_MIN_USD = "1";
  const base = await createContext();
  ctx = { ...base, email: null, verifiers: { ...base.verifiers, base: baseChainDouble } };
  app = createApp(ctx);
  platformKey = (
    await ctx.apiKeys.issue({
      organizationId: PLATFORM_ORG,
      customerId: "cus_platform",
      productId: "__platform__",
      entitlementId: "ent_platform",
      scopes: ["*"],
      env: "live",
    })
  ).plaintext;
  otherKey = (
    await ctx.apiKeys.issue({
      organizationId: "org_other",
      customerId: "cus_other",
      productId: "__platform__",
      entitlementId: "ent_other",
      scopes: ["*"],
      env: "live",
    })
  ).plaintext;
  expect(
    (await platform("POST", "/v1/merchant/profile", { orgName: "SettleKit", acceptedNetworks: ["base"], addresses: { evm: PLATFORM_WALLET } }))
      .status,
  ).toBe(200);
  expect(
    (
      await merchant("POST", "/v1/merchant/profile", {
        orgName: "Merchant Co",
        supportEmail: "owner@merchant.test",
        acceptedNetworks: ["base"],
        addresses: { evm: MERCHANT_WALLET },
      })
    ).status,
  ).toBe(200);
});

afterAll(() => {
  for (const key of ["PLATFORM_BILLING_ORG_ID", "PLATFORM_BILLING_DUE_DAYS", "PLATFORM_BILLING_GRACE_DAYS", "PLATFORM_BILLING_MIN_USD"]) {
    delete process.env[key];
  }
});

describe("platform fee statements", () => {
  it("reads the config from env and stays off when unset", () => {
    expect(loadPlatformBillingConfig({})).toBeNull();
    expect(loadPlatformBillingConfig({ PLATFORM_BILLING_ORG_ID: "org_x" })).toEqual({
      orgId: "org_x",
      dueDays: 14,
      graceDays: 14,
      minimum: "1",
    });
    expect(() => loadPlatformBillingConfig({ PLATFORM_BILLING_ORG_ID: "org_x", PLATFORM_BILLING_GRACE_DAYS: "-1" })).toThrow();
  });

  it("bills a closed month, is paid through the platform checkout, and lifts the limit", async () => {
    // Four active products (over the free limit of 3), then volume in Jan 2025.
    for (const name of ["Alpha", "Beta", "Gamma"]) expect((await quickProduct(name)).status).toBe(201);
    await settledPayment("300", "2025-01-10T00:00:00.000Z");
    await settledPayment("200", "2025-01-31T23:00:00.000Z");
    await settledPayment("999", "2025-02-01T00:00:00.000Z");

    const accrued = await merchant("GET", "/v1/billing/fees");
    expect(accrued.json.data).toMatchObject({ configured: true, standing: "good", schedule: { bps: 100 } });
    expect(accrued.json.data.accrued).toMatchObject({ paymentCount: 3, fees: "14.99" });

    // Only the platform operator can run statements.
    expect((await callAs(otherKey, "POST", "/v1/billing/statements/run", { period: "2025-01" })).status).toBe(403);
    const run = await platform("POST", "/v1/billing/statements/run", { period: "2025-01" });
    expect(run.status).toBe(200);
    expect(run.json.data.results).toEqual([
      expect.objectContaining({ merchantOrgId: DEFAULT_ORG_ID, status: "issued" }),
    ]);
    // Re-running is idempotent.
    const again = await platform("POST", "/v1/billing/statements/run", { period: "2025-01" });
    expect(again.json.data.results[0].status).toBe("exists");
    // A month that has not ended cannot be billed.
    expect((await platform("POST", "/v1/billing/statements/run", { period: "2999-01" })).json.data.results[0].status).toBe("error");

    const fees = await merchant("GET", "/v1/billing/fees");
    const [statement] = fees.json.data.statements;
    expect(statement).toMatchObject({ period: "2025-01", status: "open", total: "5", paymentCount: 2, grossVolume: "500" });
    expect(statement.payUrl).toMatch(/\/i\/[A-Za-z0-9_-]{16,}$/);
    expect(statement.dueAt).toBe("2025-02-15T00:00:00.000Z");
    // Long past due + grace: restricted.
    expect(fees.json.data.standing).toBe("restricted");
    expect(fees.json.data.accrued).toMatchObject({ paymentCount: 1, fees: "9.99" });

    // The statement is an invoice of SettleKit's own org, paid to its wallet.
    const invoice = await ctx.invoices.get(statement.id);
    if (!invoice.ok) throw new Error("statement invoice missing");
    expect(invoice.value.organizationId).toBe(PLATFORM_ORG);
    const sessionId = invoice.value.metadata.checkoutSessionIds!;
    const session = await ctx.checkouts.findById(sessionId);
    expect(session).toMatchObject({ organizationId: PLATFORM_ORG, payToAddress: PLATFORM_WALLET, amount: { amount: "5" } });
    // The merchant never sees the statement in their own invoices.
    expect((await merchant("GET", "/v1/invoices")).json.data).toHaveLength(0);

    // Restricted: the 4th active product is refused with the pay link.
    const blocked = await quickProduct("Delta");
    expect(blocked.status).toBe(402);
    expect(blocked.json.error?.code).toBe("payment_required");
    expect(blocked.json.error?.message).toContain(statement.payUrl);

    // Pay the statement onchain through the platform checkout.
    const payment = await platform("POST", "/v1/payments", { checkoutSessionId: sessionId });
    expect(payment.status).toBe(201);
    const confirmed = await platform("POST", `/v1/payments/${payment.json.data.id}/confirm`, {
      txHash: `0x${randomBytes(32).toString("hex")}`,
      confirmations: 3,
    });
    expect(confirmed.status).toBe(200);

    const after = await merchant("GET", "/v1/billing/fees");
    expect(after.json.data.statements[0].status).toBe("paid");
    expect(after.json.data.standing).toBe("good");
    expect((await quickProduct("Delta")).status).toBe(201);
  });

  it("issues one statement when runs overlap and sends a draft left by an interrupted run", async () => {
    expect((await quickProduct("Overlap")).status).toBe(201);
    await settledPayment("400", "2025-05-10T00:00:00.000Z");
    const cfg = loadPlatformBillingConfig()!;
    const now = new Date("2025-06-02T00:00:00.000Z");
    const outcomes = await Promise.all([
      runStatements(ctx, cfg, "2025-05", now),
      runStatements(ctx, cfg, "2025-05", now),
      runStatements(ctx, cfg, "2025-05", now),
    ]);
    const statuses = outcomes.map((o) => o.results[0]!.status).sort();
    expect(statuses).toEqual(["exists", "exists", "issued"]);
    const open = (await ctx.invoices.list()).filter(
      (inv) => inv.metadata.kind === "platform_fee" && inv.metadata.period === "2025-05" && inv.status !== "void",
    );
    expect(open).toHaveLength(1);
    expect(open[0]!.status).toBe("open");

    // A second instance raced in a duplicate draft: it loses to the sent one.
    const loser = await issueStatement(ctx, cfg, DEFAULT_ORG_ID, "2025-05", now);
    expect(loser.status).toBe("exists");

    // A draft left by a crash between create and send is sent on the next run.
    await settledPayment("300", "2025-06-10T00:00:00.000Z");
    const [customer] = await ctx.customers.list((c) => c.organizationId === PLATFORM_ORG);
    const draft = await ctx.invoices.create({
      organizationId: PLATFORM_ORG,
      customerId: customer!.id,
      lineItems: [{ description: "June", quantity: 1, unitAmount: money("3") }],
      metadata: { kind: "platform_fee", merchantOrgId: DEFAULT_ORG_ID, period: "2025-06", coverageEnd: "2025-07-01T00:00:00.000Z" },
    });
    if (!draft.ok) throw draft.error;
    const resumed = await issueStatement(ctx, cfg, DEFAULT_ORG_ID, "2025-06", new Date("2025-07-02T00:00:00.000Z"));
    expect(resumed.status).toBe("issued");
    if (resumed.status !== "issued") throw new Error("not issued");
    expect(resumed.invoice.id).toBe(draft.value.id);
    expect(resumed.invoice.status).toBe("open");
  });

  it("carries fees below the minimum into the next statement and skips test accounts", async () => {
    expect((await quickProduct("Solo")).status).toBe(201);
    await settledPayment("50", "2025-03-05T00:00:00.000Z"); // 0.50 fee: below the 1 USDC minimum
    const march = await platform("POST", "/v1/billing/statements/run", { period: "2025-03" });
    expect(march.json.data.results[0]).toMatchObject({ status: "below_minimum", fees: "0.5" });

    await settledPayment("100", "2025-04-05T00:00:00.000Z");
    const april = await platform("POST", "/v1/billing/statements/run", { period: "2025-04" });
    expect(april.json.data.results[0].status).toBe("issued");
    const [statement] = (await merchant("GET", "/v1/billing/fees")).json.data.statements;
    expect(statement).toMatchObject({ period: "2025-04", total: "1.5", paymentCount: 2 });

    await merchant("POST", "/v1/merchant/profile", {
      acceptedNetworks: ["base"],
      addresses: { evm: MERCHANT_WALLET },
      testAccount: true,
    });
    await settledPayment("500", "2025-05-05T00:00:00.000Z");
    const may = await platform("POST", "/v1/billing/statements/run", { period: "2025-05" });
    expect(may.json.data.results).toEqual([]);
  });
});

describe("statement scheduler", () => {
  it("bills the previous month on a tick and is disabled without config", async () => {
    const { statementTick, startStatementScheduler } = await import("../src/platform/statement-scheduler.js");
    expect((await quickProduct("Tick")).status).toBe(201);
    await settledPayment("400", "2025-06-15T00:00:00.000Z");
    const result = await statementTick(ctx, new Date("2025-07-02T00:00:00.000Z"));
    expect(result?.period).toBe("2025-06");
    expect(result?.results[0]).toMatchObject({ status: "issued" });
    const stop = startStatementScheduler(ctx, () => {}, {});
    stop();
    delete process.env.PLATFORM_BILLING_ORG_ID;
    expect(await statementTick(ctx)).toBeNull();
  });
});
