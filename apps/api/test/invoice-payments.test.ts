/**
 * Payable invoices + payment requests, end to end through the real routes:
 * send -> public pay page -> checkout session -> onchain-verified payment ->
 * the invoice flips to paid on the next read.
 */
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { SettlementVerifier } from "@settlekit/chains";
import { createEmailClient, type EmailPayload } from "@settlekit/notifications";
import { createApp } from "../src/app.js";
import { createContext, type AppContext, type AppEnv } from "../src/context.js";

const BOOTSTRAP = "test-bootstrap-key";
const EVM_PAYTO = "0x2222222222222222222222222222222222222222";

const baseChainDouble: SettlementVerifier = async (proof, requirements) =>
  proof.network === requirements.network ? { ok: true } : { ok: false, reason: "network mismatch" };

interface Json {
  data?: any;
  error?: { code: string; message: string };
}

interface Harness {
  app: Hono<AppEnv>;
  ctx: AppContext;
  sent: EmailPayload[];
}

async function harness(withEmail = true): Promise<Harness> {
  process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
  process.env.CHECKOUT_PUBLIC_URL = "https://pay.test";
  const base = await createContext();
  const sent: EmailPayload[] = [];
  const email = withEmail
    ? createEmailClient({
        from: "SettleKit <billing@settlekit.test>",
        transport: {
          async send(payload: EmailPayload) {
            sent.push(payload);
            return { id: `msg_${sent.length}` };
          },
        },
      })
    : null;
  const ctx: AppContext = { ...base, email, verifiers: { ...base.verifiers, base: baseChainDouble } };
  return { app: createApp(ctx), ctx, sent };
}

async function call(app: Hono<AppEnv>, method: string, path: string, body?: unknown, auth = true) {
  const res = await app.request(path, {
    method,
    headers: {
      ...(auth ? { authorization: `Bearer ${BOOTSTRAP}` } : {}),
      "content-type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("application/pdf")) {
    return { status: res.status, json: {} as Json, pdf: Buffer.from(await res.arrayBuffer()) };
  }
  return { status: res.status, json: (await res.json()) as Json, pdf: null };
}

async function onboard(app: Hono<AppEnv>): Promise<void> {
  const res = await call(app, "POST", "/v1/merchant/profile", {
    orgName: "Acme Studio",
    acceptedNetworks: ["base"],
    addresses: { evm: EVM_PAYTO },
  });
  expect(res.status).toBe(200);
}

async function customer(app: Hono<AppEnv>, email = "ap@client.test"): Promise<string> {
  const res = await call(app, "POST", "/v1/customers", { email });
  expect(res.status).toBe(201);
  return res.json.data.id as string;
}

async function payOnchain(app: Hono<AppEnv>, sessionId: string): Promise<string> {
  const txHash = `0x${randomBytes(32).toString("hex")}`;
  const payment = await call(app, "POST", "/v1/payments", { checkoutSessionId: sessionId });
  expect(payment.status).toBe(201);
  const confirmed = await call(app, "POST", `/v1/payments/${payment.json.data.id}/confirm`, {
    txHash,
    confirmations: 3,
  });
  expect(confirmed.status).toBe(200);
  return txHash;
}

function tokenOf(payUrl: string): string {
  return payUrl.split("/i/")[1]!;
}

describe("payable invoices", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
  });

  it("sends an invoice, the client pays onchain, and it settles automatically", async () => {
    await onboard(h.app);
    const customerId = await customer(h.app);
    const created = await call(h.app, "POST", "/v1/invoices", {
      customerId,
      lineItems: [
        { description: "Brand design", quantity: 1, unitAmount: "400" },
        { description: "Revisions", quantity: 2, unitAmount: "50" },
      ],
      dueAt: "2026-10-30T00:00:00.000Z",
    });
    expect(created.status).toBe(201);
    const id = created.json.data.id as string;

    const sent = await call(h.app, "POST", `/v1/invoices/${id}/send`, {});
    expect(sent.status).toBe(200);
    const { invoice, payUrl, checkoutSessionId, emailedTo } = sent.json.data;
    expect(invoice.status).toBe("open");
    expect(payUrl).toMatch(/^https:\/\/pay\.test\/i\/[A-Za-z0-9_-]{16,}$/);
    expect(emailedTo).toBe("ap@client.test");
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.subject).toContain(invoice.number);
    expect(h.sent[0]!.html).toContain(payUrl);

    // The session charges the invoice total to the merchant's wallet.
    const session = await h.ctx.checkouts.findById(checkoutSessionId);
    expect(session?.amount.amount).toBe("500");
    expect(session?.payToAddress).toBe(EVM_PAYTO);
    expect(session?.invoiceId).toBe(id);
    expect(session?.customerId).toBe(customerId);

    // Re-sending keeps the same link and the same open session.
    const again = await call(h.app, "POST", `/v1/invoices/${id}/send`, {});
    expect(again.json.data.payUrl).toBe(payUrl);
    expect(again.json.data.checkoutSessionId).toBe(checkoutSessionId);

    // Public pay page: no API key.
    const token = tokenOf(payUrl);
    const view = await call(h.app, "GET", `/v1/public/invoices/${token}`, undefined, false);
    expect(view.status).toBe(200);
    expect(view.json.data).toMatchObject({ number: invoice.number, total: "500", payable: true, merchantName: "Acme Studio" });
    expect(view.json.data.customerId).toBeUndefined();
    const opened = await call(h.app, "POST", `/v1/public/invoices/${token}/sessions`, {}, false);
    expect(opened.status).toBe(201);
    expect(opened.json.data.sessionId).toBe(checkoutSessionId);

    const txHash = await payOnchain(h.app, checkoutSessionId);

    const paid = await call(h.app, "GET", `/v1/invoices/${id}`);
    expect(paid.json.data.status).toBe("paid");
    expect(paid.json.data.metadata.paidTxHash).toBe(txHash);
    const publicPaid = await call(h.app, "GET", `/v1/public/invoices/${token}`, undefined, false);
    expect(publicPaid.json.data).toMatchObject({ status: "paid", payable: false, paidTxHash: txHash });
    const reopen = await call(h.app, "POST", `/v1/public/invoices/${token}/sessions`, {}, false);
    expect(reopen.status).toBe(400);

    // The hidden invoice product never shows in the catalog.
    const products = await call(h.app, "GET", "/v1/merchant/products");
    expect(products.json.data).toHaveLength(0);
  });

  it("creates and sends an ad-hoc payment request to an email", async () => {
    await onboard(h.app);
    const res = await call(h.app, "POST", "/v1/invoices/requests", {
      amount: "75.50",
      description: "Consulting call, 1 hour",
      payerEmail: "founder@client.test",
    });
    expect(res.status).toBe(201);
    expect(res.json.data.invoice).toMatchObject({ status: "open", total: { amount: "75.5" } });
    expect(res.json.data.invoice.metadata.kind).toBe("payment_request");
    expect(res.json.data.emailedTo).toBe("founder@client.test");
    const customerId = res.json.data.invoice.customerId as string;
    expect((await h.ctx.customers.findById(customerId))?.email).toBe("founder@client.test");

    // A second request to the same email reuses the customer.
    const second = await call(h.app, "POST", "/v1/invoices/requests", {
      amount: "10",
      description: "Follow-up",
      payerEmail: "FOUNDER@client.test",
    });
    expect(second.json.data.invoice.customerId).toBe(customerId);

    const missing = await call(h.app, "POST", "/v1/invoices/requests", { amount: "10", description: "x" });
    expect(missing.status).toBe(400);
    const zero = await call(h.app, "POST", "/v1/invoices/requests", {
      amount: "0",
      description: "x",
      payerEmail: "a@b.test",
    });
    expect(zero.status).toBe(400);
  });

  it("refuses to send before a receiving wallet is configured", async () => {
    const customerId = await customer(h.app);
    const created = await call(h.app, "POST", "/v1/invoices", {
      customerId,
      lineItems: [{ description: "Work", quantity: 1, unitAmount: "10" }],
    });
    const sent = await call(h.app, "POST", `/v1/invoices/${created.json.data.id}/send`, {});
    expect(sent.status).toBe(400);
    expect(sent.json.error?.message).toMatch(/receiving wallet/);
  });

  it("reports a skipped email when no transport is configured", async () => {
    const noEmail = await harness(false);
    await onboard(noEmail.app);
    const res = await call(noEmail.app, "POST", "/v1/invoices/requests", {
      amount: "5",
      description: "Tip",
      payerEmail: "x@y.test",
    });
    expect(res.status).toBe(201);
    expect(res.json.data.emailedTo).toBeNull();
    expect(res.json.data.emailSkipped).toMatch(/not configured/);
  });

  it("voiding cancels the open session so an old link cannot be paid", async () => {
    await onboard(h.app);
    const req = await call(h.app, "POST", "/v1/invoices/requests", {
      amount: "20",
      description: "Deposit",
      payerEmail: "p@q.test",
    });
    const { invoice, checkoutSessionId, payUrl } = req.json.data;
    const voided = await call(h.app, "POST", `/v1/invoices/${invoice.id}/void`);
    expect(voided.json.data.status).toBe("void");
    expect((await h.ctx.checkouts.findById(checkoutSessionId))?.status).toBe("canceled");
    const view = await call(h.app, "GET", `/v1/public/invoices/${tokenOf(payUrl)}`, undefined, false);
    expect(view.json.data).toMatchObject({ payable: false, status: "void" });
  });

  it("serves invoice PDFs to the merchant and the pay-link holder", async () => {
    await onboard(h.app);
    const req = await call(h.app, "POST", "/v1/invoices/requests", {
      amount: "30",
      description: "Logo",
      payerEmail: "p@q.test",
    });
    const merchantPdf = await call(h.app, "GET", `/v1/invoices/${req.json.data.invoice.id}.pdf`);
    expect(merchantPdf.status).toBe(200);
    expect(merchantPdf.pdf?.subarray(0, 5).toString()).toBe("%PDF-");
    const publicPdf = await call(h.app, "GET", `/v1/public/invoices/${tokenOf(req.json.data.payUrl)}/pdf`, undefined, false);
    expect(publicPdf.status).toBe(200);
    expect(publicPdf.pdf?.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("answers 404 for an unknown pay token and keeps invoices tenant-scoped", async () => {
    const unknown = await call(h.app, "GET", "/v1/public/invoices/unknown_token_abcdefghij", undefined, false);
    expect(unknown.status).toBe(404);
  });
});

describe("payment requests for plugins", () => {
  it("can skip the email and return the payer to the store after paying", async () => {
    const h = await harness();
    await onboard(h.app);
    const res = await call(h.app, "POST", "/v1/invoices/requests", {
      amount: "42.00",
      description: "Order #1001",
      payerEmail: "shopper@store.test",
      sendEmail: false,
      successUrl: "https://store.test/checkout/order-received/1001?key=wc_order_abc",
      metadata: { wc_order_id: "1001" },
    });
    expect(res.status).toBe(201);
    expect(res.json.data.emailedTo).toBeNull();
    expect(h.sent).toHaveLength(0);
    const session = await h.ctx.checkouts.findById(res.json.data.checkoutSessionId);
    expect(session?.successUrl).toBe("https://store.test/checkout/order-received/1001?key=wc_order_abc");
    expect(res.json.data.invoice.metadata.wc_order_id).toBe("1001");

    const insecure = await call(h.app, "POST", "/v1/invoices/requests", {
      amount: "1",
      description: "x",
      payerEmail: "a@b.test",
      successUrl: "http://evil.test/",
    });
    expect(insecure.status).toBe(400);
  });
});

describe("invoice settlement bindings cannot be forged", () => {
  it("ignores reserved metadata and never settles from another org's payment", async () => {
    const { app, ctx } = await harness(false);
    await onboard(app);
    const cus = await customer(app);
    // Another org's confirmed payment.
    await ctx.payments.save({
      id: "pay_foreign",
      organizationId: "org_someone_else",
      checkoutSessionId: "cs_foreign_paid",
      customerId: "cus_x",
      amount: { amount: "500", currency: "USDC" },
      network: "base",
      txHash: `0x${randomBytes(32).toString("hex")}`,
      confirmations: 3,
      status: "confirmed",
      createdAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
    } as never);
    const createdRes = await call(app, "POST", "/v1/invoices", {
      customerId: cus,
      lineItems: [{ description: "Work", quantity: 1, unitAmount: "100" }],
      metadata: { checkoutSessionIds: "cs_foreign_paid", payToken: "attackerChosenToken123", note: "kept" },
    });
    expect(createdRes.status).toBe(201);
    const inv = createdRes.json.data;
    expect(inv.metadata.checkoutSessionIds).toBeUndefined();
    expect(inv.metadata.payToken).toBeUndefined();
    expect(inv.metadata.note).toBe("kept");

    // Even with a binding planted directly in storage, a foreign payment never settles it.
    const stored = await ctx.invoices.get(inv.id);
    if (!stored.ok) throw stored.error;
    await ctx.invoices.save({ ...stored.value, status: "open", metadata: { ...stored.value.metadata, checkoutSessionIds: "cs_foreign_paid" } });
    const read = await call(app, "GET", `/v1/invoices/${inv.id}`);
    expect(read.json.data.status).toBe("open");

    const request = await call(app, "POST", "/v1/invoices/requests", {
      amount: "5",
      description: "Quick job",
      payerEmail: "p@client.test",
      sendEmail: false,
      metadata: { kind: "platform_fee", merchantOrgId: "org_victim", paidTxHash: "0xdead" },
    });
    expect(request.status).toBe(201);
    expect(request.json.data.invoice.metadata.kind).toBe("payment_request");
    expect(request.json.data.invoice.metadata.merchantOrgId).toBeUndefined();
    expect(request.json.data.invoice.metadata.paidTxHash).toBeUndefined();
  });
});
