/**
 * Onchain billing routes (API-key guarded; the checkout calls these server-side):
 *
 *   GET  /v1/onchain-billing/networks                     billable networks + methods
 *   POST /v1/onchain-billing/subscriptions                create intent -> what the buyer signs/sends
 *   GET  /v1/onchain-billing/subscriptions?customerId=    list (org-scoped)
 *   GET  /v1/onchain-billing/subscriptions/:id            one subscription + its charges
 *   POST /v1/onchain-billing/subscriptions/:id/grant      submit the signed grant; charges period 0
 *   POST /v1/onchain-billing/subscriptions/:id/charge     charge the due period now (idempotent)
 *   POST /v1/onchain-billing/subscriptions/:id/cancel     cancel (at period end by default) + revoke actions
 *   POST /v1/onchain-billing/escrow                       Base escrow intent (commerce-payments)
 *   GET  /v1/onchain-billing/escrow/:id                   escrow payment record
 *   POST /v1/onchain-billing/escrow/:id/authorize         submit the payer signature
 *   POST /v1/onchain-billing/escrow/:id/capture|void      operator actions
 *   GET  /v1/onchain-billing/escrow/:id/reclaim           payer calldata after authorization expiry
 *   POST /v1/onchain-billing/refunds                      owner refund, dispatched per network
 */
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  SettleKitError,
  fromBaseUnits,
  generateId,
  isPaymentNetwork,
  money,
  notFound,
  toBaseUnits,
  validationError,
  type Payment,
} from "@settlekit/common";
import { checkPayTo, type Hex } from "@settlekit/chains";
import { completeSession, createCheckoutSession } from "@settlekit/payments";
import {
  BILLING_METHODS,
  ChargeDeclinedError,
  RefundUnsupportedError,
  chargeIdForPayment,
  paymentInfoFromJson,
  type BillingNetwork,
  type OnchainBillingRuntime,
} from "@settlekit/onchain-billing";
import { DEFAULT_MERCHANT_ID } from "@settlekit/persistence";
import type { AppContext, AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { requireOrg } from "../http/tenant.js";
import { unwrapResult } from "../http/internal.js";

const BILLING_NETWORKS = ["solana", "base", "arc", "ethereum", "arbitrum", "robinhood", "hyperevm", "tempo", "zcash", "hypercore"] as const;
const amount = z.string().regex(/^\d+(\.\d{1,6})?$/, "decimal amount with up to 6 decimals");

const createSchema = z.object({
  network: z.enum(BILLING_NETWORKS),
  method: z.enum(BILLING_METHODS as unknown as [string, ...string[]]),
  customerId: z.string().min(1),
  productId: z.string().min(1),
  priceId: z.string().min(1),
  payTo: z.string().min(1),
  payer: z.string().min(1).optional(),
  email: z.string().email().optional(),
  periods: z.number().int().min(1).max(120).optional(),
  /** Link to an existing core subscription (else one is created on first charge). */
  subscriptionId: z.string().min(1).optional(),
});

const grantSchema = z.object({
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
  approveSignature: z.string().min(32).optional(),
});

const cancelSchema = z.object({ atPeriodEnd: z.boolean().optional() });

const escrowSchema = z.object({
  payer: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  receiver: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  amount,
  collector: z.enum(["erc3009", "permit2", "pre_approval"]),
  autoCapture: z.boolean().optional(),
  customerId: z.string().min(1),
  authorizationTtlSeconds: z.number().int().min(60).max(30 * 86_400).optional(),
  refundTtlSeconds: z.number().int().min(60).max(365 * 86_400).optional(),
});

const captureSchema = z.object({ amount: amount.optional() });

const refundSchema = z
  .object({
    paymentId: z.string().min(1).optional(),
    escrowPaymentId: z.string().min(1).optional(),
    amount,
    reason: z.enum(["duplicate", "fraudulent", "customer_request", "delivery_failed"]),
    /** Recipient for payments not made through onchain billing. */
    to: z.string().min(1).optional(),
  })
  .refine((b) => b.paymentId !== undefined || b.escrowPaymentId !== undefined, { message: "paymentId or escrowPaymentId is required" });

/** JSON-safe payloads: bigints (typed data, amounts) become decimal strings. */
function jsonSafe<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));
}

function billing(c: Context<AppEnv>): OnchainBillingRuntime {
  const runtime = c.get("ctx").onchainBilling;
  if (!runtime) throw notFound("onchain billing is not configured (set ONCHAIN_BILLING_OPERATOR_PRIVATE_KEY / ONCHAIN_BILLING_CHECKOUT_URL)");
  return runtime;
}

/** Map domain errors onto the API's error envelope. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (SettleKitError.is(error)) throw error;
    if (error instanceof ChargeDeclinedError || error instanceof RangeError || error instanceof RefundUnsupportedError) {
      throw validationError(error.message);
    }
    if (error instanceof Error && /not found/.test(error.message)) throw notFound(error.message);
    throw error;
  }
}

async function ownedSubscription(c: Context<AppEnv>, id: string) {
  const sub = await billing(c).subscriptions.get(id);
  if (!sub || sub.organizationId !== requireOrg(c)) throw notFound("onchain subscription not found", { id });
  return sub;
}

async function ownedEscrow(c: Context<AppEnv>, id: string) {
  const record = await billing(c).store.getEscrowPayment(id);
  if (!record || record.organizationId !== requireOrg(c)) throw notFound("escrow payment not found", { id });
  return record;
}

/** A checkout-session record for the purchase, so charges' Payments reference it. */
async function recordSession(ctx: AppContext, input: { organizationId: string; customerId?: string; productId?: string; priceId: string; amount: string; network: BillingNetwork; payTo: string }): Promise<string | undefined> {
  if (!isPaymentNetwork(input.network)) return undefined;
  const session = createCheckoutSession({
    organizationId: input.organizationId,
    merchantId: DEFAULT_MERCHANT_ID,
    ...(input.customerId ? { customerId: input.customerId } : {}),
    items: [
      {
        lineItem: { ...(input.productId ? { productId: input.productId } : {}), priceId: input.priceId, quantity: 1 },
        price: { id: input.priceId, productId: input.productId ?? "", amount: input.amount, currency: "USDC", interval: "monthly", usageBased: false, active: true, createdAt: new Date().toISOString() },
      },
    ],
    payToAddress: input.payTo,
    network: input.network,
    collectedFields: { source: "onchain_billing" },
  });
  return (await ctx.checkouts.save(session)).id;
}

async function completeRecordedSession(ctx: AppContext, sessionId: string | undefined): Promise<void> {
  if (!sessionId) return;
  const session = await ctx.checkouts.findById(sessionId);
  if (session && session.status === "open") await ctx.checkouts.save(completeSession(session));
}

export function onchainBillingRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/networks", (c) => {
    const runtime = billing(c);
    const networks = Object.values(runtime.assets).map((asset) => ({
      ...asset,
      methods: runtime.subscriptions.methodsFor(asset.network),
    }));
    return data(c, {
      networks,
      operator: runtime.operatorAddress,
      solanaDelegate: runtime.solanaDelegate,
      escrow: runtime.escrow !== null,
      notes: runtime.notes,
    });
  });

  app.post("/subscriptions", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, createSchema);
    const runtime = billing(c);
    const price = await ctx.prices.findById(body.priceId);
    if (!price) throw notFound("price not found", { id: body.priceId });
    if (price.interval !== "monthly" && price.interval !== "yearly") {
      throw validationError("onchain subscriptions need a monthly or yearly price", { priceId: price.id });
    }
    if (price.productId !== body.productId) throw validationError("price does not belong to product", { priceId: price.id });
    if (isPaymentNetwork(body.network)) {
      const check = checkPayTo(body.network, body.payTo);
      if (!check.ok) throw validationError(`payTo ${check.reason}`);
    }
    const organizationId = requireOrg(c);
    const checkoutSessionId = await recordSession(ctx, {
      organizationId,
      customerId: body.customerId,
      productId: body.productId,
      priceId: price.id,
      amount: price.amount,
      network: body.network,
      payTo: body.payTo,
    });
    const intent = await guard(() =>
      runtime.subscriptions.createIntent({
        id: `osub_${generateId("subscription").replace(/^[a-z]+_/, "")}`,
        organizationId,
        customerId: body.customerId,
        productId: body.productId,
        priceId: price.id,
        ...(body.subscriptionId ? { subscriptionId: body.subscriptionId } : { subscriptionId: generateId("subscription") }),
        ...(checkoutSessionId ? { checkoutSessionId } : {}),
        network: body.network,
        method: body.method as never,
        ...(body.payer ? { payer: body.payer } : {}),
        payTo: body.payTo,
        amount: price.amount,
        interval: price.interval as "monthly" | "yearly",
        ...(body.periods ? { periods: body.periods } : {}),
        ...(body.email ? { email: body.email } : {}),
      }),
    );
    return created(c, jsonSafe(intent));
  });

  app.get("/subscriptions", async (c) => {
    const customerId = c.req.query("customerId");
    const list = await billing(c).subscriptions.list({ organizationId: requireOrg(c), ...(customerId ? { customerId } : {}) });
    return data(c, list);
  });

  app.get("/subscriptions/:id", async (c) => {
    const sub = await ownedSubscription(c, c.req.param("id"));
    return data(c, { subscription: sub, charges: await billing(c).store.listCharges(sub.id) });
  });

  app.post("/subscriptions/:id/grant", async (c) => {
    const ctx = c.get("ctx");
    const runtime = billing(c);
    const sub = await ownedSubscription(c, c.req.param("id"));
    const body = await parseBody(c, grantSchema);
    const active = await guard(() =>
      runtime.subscriptions.submitGrant(sub.id, {
        ...(body.signature ? { signature: body.signature } : {}),
        ...(body.approveSignature ? { approveSignature: body.approveSignature } : {}),
      }),
    );
    await completeRecordedSession(ctx, active.checkoutSessionId);
    const outcome = await runtime.engine.chargeSubscription(active.id);
    if (outcome === "succeeded") await grantAccess(ctx, active.subscriptionId, active.productId);
    return data(c, {
      subscription: await runtime.subscriptions.get(active.id),
      firstCharge: { outcome, charge: await runtime.store.getCharge(active.id, 0) },
    });
  });

  app.post("/subscriptions/:id/charge", async (c) => {
    const runtime = billing(c);
    const sub = await ownedSubscription(c, c.req.param("id"));
    const outcome = await runtime.engine.chargeSubscription(sub.id);
    return data(c, { outcome, subscription: await runtime.subscriptions.get(sub.id), charges: await runtime.store.listCharges(sub.id) });
  });

  app.post("/subscriptions/:id/cancel", async (c) => {
    const sub = await ownedSubscription(c, c.req.param("id"));
    const body = await parseBody(c, cancelSchema);
    const result = await guard(() => billing(c).subscriptions.cancel(sub.id, body.atPeriodEnd ?? true));
    return data(c, jsonSafe(result));
  });

  app.post("/escrow", async (c) => {
    const ctx = c.get("ctx");
    const runtime = billing(c);
    if (!runtime.escrow) throw notFound("Base escrow is not configured (enable base with ONCHAIN_BILLING_OPERATOR_PRIVATE_KEY)");
    const escrow = runtime.escrow;
    const body = await parseBody(c, escrowSchema);
    const base = runtime.assets.base;
    if (!base?.chainId) throw validationError("base is not an enabled network");
    const organizationId = requireOrg(c);
    const id = `esc_${generateId("payment").replace(/^[a-z]+_/, "")}`;
    const checkoutSessionId = await recordSession(ctx, {
      organizationId,
      customerId: body.customerId,
      priceId: `escrow:${id}`,
      amount: body.amount,
      network: "base",
      payTo: body.receiver,
    });
    const intent = await guard(() =>
      escrow.createIntent({
        id,
        organizationId,
        customerId: body.customerId,
        ...(checkoutSessionId ? { checkoutSessionId } : {}),
        payer: body.payer as Hex,
        receiver: body.receiver as Hex,
        token: base.token as Hex,
        amount: toBaseUnits(body.amount),
        collector: body.collector,
        ...(body.autoCapture !== undefined ? { autoCapture: body.autoCapture } : {}),
        ...(body.authorizationTtlSeconds ? { authorizationTtlSeconds: body.authorizationTtlSeconds } : {}),
        ...(body.refundTtlSeconds ? { refundTtlSeconds: body.refundTtlSeconds } : {}),
        tokenDomain: base.chainId === 8453 ? { name: "USD Coin", version: "2" } : { name: "USDC", version: "2" },
      }),
    );
    return created(c, jsonSafe(intent));
  });

  app.get("/escrow/:id", async (c) => data(c, await ownedEscrow(c, c.req.param("id"))));

  app.post("/escrow/:id/authorize", async (c) => {
    const ctx = c.get("ctx");
    const record = await ownedEscrow(c, c.req.param("id"));
    const body = await parseBody(c, z.object({ signature: z.string().regex(/^0x[0-9a-fA-F]*$/) }));
    const runtime = billing(c);
    const chainId = record.chainId;
    const updated = await guard(() =>
      (runtime.escrow as NonNullable<typeof runtime.escrow>).submitSignature(
        record.id,
        body.signature as Hex,
        chainId === 8453 ? { name: "USD Coin", version: "2" } : { name: "USDC", version: "2" },
      ),
    );
    if (updated.status === "captured") await recordEscrowPayment(ctx, updated.id);
    return data(c, updated);
  });

  app.post("/escrow/:id/capture", async (c) => {
    const ctx = c.get("ctx");
    const record = await ownedEscrow(c, c.req.param("id"));
    const body = await parseBody(c, captureSchema);
    const runtime = billing(c);
    const updated = await guard(() =>
      (runtime.escrow as NonNullable<typeof runtime.escrow>).capture(record.id, body.amount ? toBaseUnits(body.amount) : undefined),
    );
    await recordEscrowPayment(ctx, updated.id);
    return data(c, updated);
  });

  app.post("/escrow/:id/void", async (c) => {
    const record = await ownedEscrow(c, c.req.param("id"));
    const runtime = billing(c);
    return data(c, await guard(() => (runtime.escrow as NonNullable<typeof runtime.escrow>).void(record.id)));
  });

  app.get("/escrow/:id/reclaim", async (c) => {
    const record = await ownedEscrow(c, c.req.param("id"));
    const runtime = billing(c);
    return data(c, await guard(() => (runtime.escrow as NonNullable<typeof runtime.escrow>).reclaimCall(record.id)));
  });

  app.post("/refunds", async (c) => {
    const ctx = c.get("ctx");
    const runtime = billing(c);
    const body = await parseBody(c, refundSchema);
    const target = await resolveRefundTarget(c, body);
    const refund = unwrapResult(
      await ctx.refunds.create({ payment: target.payment, customerId: target.payment.customerId, amount: body.amount, reason: body.reason }),
    );
    try {
      const execution = await guard(() =>
        runtime.refunds.refund({
          network: target.network,
          to: target.to,
          amount: toBaseUnits(body.amount),
          reference: refund.id,
          ...(target.escrowPaymentId ? { escrowPaymentId: target.escrowPaymentId } : {}),
        }),
      );
      const succeeded = unwrapResult(await ctx.refunds.markSucceeded(refund.id));
      return created(c, { refund: succeeded, execution });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "refund failed";
      await ctx.refunds.markFailed(refund.id, reason);
      throw error;
    }
  });

  return app;
}

/** First paid period: grant the product entitlement for the new core subscription. */
async function grantAccess(ctx: AppContext, subscriptionId: string | undefined, productId: string): Promise<void> {
  if (!subscriptionId) return;
  const subscription = await ctx.subscriptions.findById(subscriptionId);
  const product = await ctx.products.findById(productId);
  if (!subscription || !product) return;
  const existing = await ctx.entitlementRepo.listByCustomer(subscription.customerId);
  if (existing.some((e) => e.productId === productId && e.status === "active")) return;
  await ctx.entitlements.grantFromSubscription({ subscription, product });
}

interface RefundTarget {
  payment: Payment;
  network: BillingNetwork;
  to: string;
  escrowPaymentId?: string;
}

function escrowPaymentId(escrowId: string): string {
  return `pay_${escrowId}`;
}

/** Record the captured escrow amount as a confirmed core Payment (refunds need one). */
async function recordEscrowPayment(ctx: AppContext, escrowId: string): Promise<void> {
  const runtime = ctx.onchainBilling;
  const record = runtime ? await runtime.store.getEscrowPayment(escrowId) : undefined;
  if (!record || BigInt(record.capturedAmount) === 0n) return;
  const capture = [...record.txs].reverse().find((t) => t.action === "capture" || t.action === "charge");
  if (!record.checkoutSessionId || !record.customerId) return;
  const existing = await ctx.payments.findById(escrowPaymentId(escrowId));
  await completeRecordedSession(ctx, record.checkoutSessionId);
  const checkoutSessionId = record.checkoutSessionId;
  await ctx.payments.save({
    id: escrowPaymentId(escrowId),
    organizationId: record.organizationId,
    checkoutSessionId,
    customerId: record.customerId,
    amount: money(fromBaseUnits(BigInt(record.capturedAmount))),
    network: "base",
    ...(existing?.txHash ?? capture?.txHash ? { txHash: (existing?.txHash ?? capture?.txHash) as string } : {}),
    confirmations: 1,
    status: "confirmed",
    createdAt: existing?.createdAt ?? record.createdAt,
    confirmedAt: new Date().toISOString(),
  });
}

async function resolveRefundTarget(
  c: Context<AppEnv>,
  body: { paymentId?: string | undefined; escrowPaymentId?: string | undefined; to?: string | undefined },
): Promise<RefundTarget> {
  const ctx = c.get("ctx");
  const runtime = billing(c);
  const org = requireOrg(c);
  const escrowId = body.escrowPaymentId ?? (body.paymentId?.startsWith("pay_esc_") ? body.paymentId.slice("pay_".length) : undefined);
  if (escrowId) {
    const record = await ownedEscrow(c, escrowId);
    const payment = await ctx.payments.findById(escrowPaymentId(escrowId));
    if (!payment) throw validationError("escrow payment has not been captured yet");
    return { payment, network: "base", to: paymentInfoFromJson(record.paymentInfo).payer, escrowPaymentId: escrowId };
  }
  const payment = await ctx.payments.findById(body.paymentId as string);
  if (!payment || payment.organizationId !== org) throw notFound("payment not found", { id: body.paymentId });
  const chargeId = chargeIdForPayment(payment.id);
  if (chargeId) {
    const charge = await runtime.store.getChargeById(chargeId);
    const sub = charge ? await runtime.store.getSubscription(charge.onchainSubscriptionId) : undefined;
    if (!sub) throw notFound("onchain charge for payment not found", { id: payment.id });
    return { payment, network: sub.network, to: sub.payer };
  }
  if (!body.to) throw validationError("`to` (the payer's address) is required for payments made outside onchain billing");
  if (isPaymentNetwork(payment.network)) {
    const check = checkPayTo(payment.network, body.to);
    if (!check.ok) throw validationError(`to ${check.reason}`);
  }
  return { payment, network: payment.network, to: body.to };
}
