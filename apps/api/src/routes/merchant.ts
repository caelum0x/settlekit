/**
 * Merchant workspace routes (dashboard). Every read and write is scoped to
 * the authenticated organization.
 *
 *   GET   /v1/merchant/profile               networks + receiving addresses
 *   POST  /v1/merchant/profile               save networks + addresses (validated per chain)
 *   GET   /v1/merchant/networks              networks this deployment runs (env, asset, enabled)
 *   GET   /v1/merchant/overview              onboarding state + headline numbers
 *   GET   /v1/merchant/payments              enriched payments (all networks)
 *   GET   /v1/merchant/payments/:id          payment detail + timeline
 *   POST  /v1/merchant/payments/:id/refund   record a refund sent manually (+ optionally revoke access)
 *   GET   /v1/merchant/products              products with price + payment link
 *   POST  /v1/merchant/products              create + price + publish in one step
 *   PATCH /v1/merchant/products/:id          edit name / price / delivery / networks / status
 *   GET   /v1/merchant/customers             buyers with spend + entitlements
 *   GET   /v1/merchant/balances              live on-chain balances of receiving addresses
 */
import { Hono, type Context } from "hono";
import { z } from "zod";
import { conflict, isPaymentNetwork, notFound, toBaseUnits, validationError, type Payment, type Product } from "@settlekit/common";
import { isValidTxHash } from "@settlekit/chains";
import { refundPayment } from "@settlekit/payments";
import type { AppContext, AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { unwrapResult } from "../http/internal.js";
import { requireOrg, requireOwned, requireOwnedPayment } from "../http/tenant.js";
import { loadProfile, networksForProfile, profileInputSchema, saveProfile } from "../merchant/profile.js";
import { networkCatalog } from "../merchant/network-catalog.js";
import { buildPaymentDetail, buildPaymentViews } from "../merchant/payment-views.js";
import {
  createQuickProduct,
  productPatchSchema,
  productView,
  quickProductSchema,
  updateProduct,
} from "../merchant/products.js";
import { listCustomers } from "../merchant/customers.js";
import { readBalances } from "../merchant/balances.js";
import { refundSucceededWebhook } from "@settlekit/persistence";
import { emitWebhook } from "../webhooks/outbox.js";
import { isInvoiceProduct } from "../merchant/invoice-payments.js";
import { configuredOfframps, offrampLinks } from "../payouts/offramp.js";
import { assertDestination, payerAddressFor, refundPlan, supportsWalletRefund } from "../merchant/refund-to-payer.js";
import { assertTxHashUnused, requireTxHash, verifyOnChainOrThrow } from "./payment-verification.js";
import type { Refund } from "@settlekit/refunds";
import { assertCanCreateProduct } from "../platform/fee-statements.js";

const refundSchema = z.object({
  reason: z.enum(["duplicate", "fraudulent", "customer_request", "delivery_failed"]).default("customer_request"),
  /** Partial refund amount in USD; defaults to the full payment. */
  amountUsd: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
  /** Transaction that sent the funds back from the merchant's wallet. */
  txHash: z.string().trim().min(1).optional(),
  revokeAccess: z.boolean().default(true),
});

const prepareRefundSchema = z.object({
  reason: z.enum(["duplicate", "fraudulent", "customer_request", "delivery_failed"]).default("customer_request"),
  /** Partial refund amount; defaults to what is still refundable. */
  amountUsd: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
  /** Buyer wallet; defaults to the wallet that paid when known. */
  to: z.string().trim().min(1).optional(),
});

const confirmRefundSchema = z.object({
  txHash: z.string().trim().min(1),
  revokeAccess: z.boolean().default(true),
});

/**
 * Mark a refund succeeded: full refunds flip the payment to refunded, access
 * granted by the payment is revoked (unless told not to) and the seller's
 * refund.succeeded webhook is queued.
 */
async function settleRefund(
  ctx: AppContext,
  payment: Payment,
  pending: Refund,
  options: { txHash?: string; revokeAccess: boolean; source: "manual" | "wallet" },
): Promise<Refund> {
  const settled = unwrapResult(await ctx.refunds.markSucceeded(pending.id));
  const refund = options.txHash ? await ctx.refundStore.save({ ...settled, txHash: options.txHash }) : settled;
  const amount = refund.amount.amount;
  const priorOthers = (await ctx.refunds.listByPayment(payment.id)).filter((r) => r.id !== refund.id && r.status === "succeeded");
  const refundedTotal = priorOthers.reduce((sum, r) => sum + toBaseUnits(r.amount.amount), toBaseUnits(amount));
  if (refundedTotal >= toBaseUnits(payment.amount.amount)) await ctx.payments.save(refundPayment(payment));
  if (options.revokeAccess) {
    const granted = (await ctx.entitlementRepo.listByCustomer(payment.customerId)).filter(
      (e) => e.grantedBy.type === "payment" && e.grantedBy.id === payment.id && e.status !== "revoked",
    );
    for (const e of granted) await ctx.entitlements.revoke(e.id, `refunded (${refund.reason})`);
  }
  await emitWebhook(
    ctx.webhookOutbox,
    refundSucceededWebhook({
      refundId: refund.id,
      payment,
      amount,
      reason: refund.reason,
      txHash: options.txHash ?? null,
      source: options.source,
    }),
  );
  return refund;
}

async function ownedProduct(c: Context<AppEnv>, id: string): Promise<Product> {
  return requireOwned(c, await c.get("ctx").products.findById(id), "product", id);
}

export function merchantRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/profile", async (c) => {
    const profile = await loadProfile(c.get("ctx"), requireOrg(c));
    return data(c, { profile, networks: networksForProfile(profile) });
  });

  app.post("/profile", async (c) => {
    const body = await parseBody(c, profileInputSchema);
    const profile = await saveProfile(c.get("ctx"), requireOrg(c), body);
    return data(c, { profile, networks: networksForProfile(profile) });
  });

  app.get("/networks", (c) => data(c, networkCatalog()));

  app.get("/overview", async (c) => {
    const ctx = c.get("ctx");
    const org = requireOrg(c);
    const [profile, payments, products] = await Promise.all([
      loadProfile(ctx, org),
      ctx.payments.listByOrganization(org),
      ctx.products.list((p) => p.organizationId === org && !isInvoiceProduct(p)),
    ]);
    const confirmed = payments.filter((p) => p.status === "confirmed");
    const byNetwork: Record<string, { count: number; volumeUsd: number }> = {};
    for (const p of confirmed) {
      const prev = byNetwork[p.network] ?? { count: 0, volumeUsd: 0 };
      byNetwork[p.network] = { count: prev.count + 1, volumeUsd: prev.volumeUsd + Number(p.amount.amount) };
    }
    const firstProduct = products.find((p) => p.status === "active");
    return data(c, {
      onboarded: profile.onboarded,
      acceptedNetworks: profile.acceptedNetworks,
      productCount: products.length,
      firstProduct: firstProduct ? await productView(ctx, firstProduct) : null,
      paymentCount: confirmed.length,
      volumeUsd: confirmed.reduce((sum, p) => sum + Number(p.amount.amount), 0).toFixed(2),
      byNetwork,
    });
  });

  app.get("/payments", async (c) => {
    const ctx = c.get("ctx");
    const status = c.req.query("status");
    const network = c.req.query("network");
    const all = await ctx.payments.listByOrganization(requireOrg(c));
    const filtered = all
      .filter((p) => !status || p.status === status)
      .filter((p) => !network || p.network === network)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return data(c, await buildPaymentViews(ctx, filtered));
  });

  app.get("/payments/:id", async (c) => {
    const payment = await requireOwnedPayment(c, c.req.param("id"));
    return data(c, await buildPaymentDetail(c.get("ctx"), payment));
  });

  app.post("/payments/:id/refund", async (c) => {
    const ctx = c.get("ctx");
    const payment = await requireOwnedPayment(c, c.req.param("id"));
    const body = await parseBody(c, refundSchema);
    if (payment.status !== "confirmed") throw conflict(`only confirmed payments can be refunded (payment is ${payment.status})`);
    if (body.txHash !== undefined && !isValidTxHash(payment.network, body.txHash)) {
      throw validationError(`refund transaction hash is not a valid ${payment.network} transaction id`);
    }
    const amount = body.amountUsd ?? payment.amount.amount;
    const pending = unwrapResult(
      await ctx.refunds.create({ payment, customerId: payment.customerId, amount, reason: body.reason }),
    );
    const refund = await settleRefund(ctx, payment, pending, {
      ...(body.txHash ? { txHash: body.txHash } : {}),
      revokeAccess: body.revokeAccess,
      source: "manual",
    });
    const updated = await ctx.payments.findById(payment.id);
    return data(c, { refund, payment: await buildPaymentDetail(ctx, updated ?? payment) });
  });

  // Refund to payer, step 1: prepare the exact transfer back to the buyer's
  // wallet for the merchant to sign (SettleKit never holds or signs funds).
  app.post("/payments/:id/refund/prepare", async (c) => {
    const ctx = c.get("ctx");
    const payment = await requireOwnedPayment(c, c.req.param("id"));
    const body = await parseBody(c, prepareRefundSchema);
    if (payment.status !== "confirmed") throw conflict(`only confirmed payments can be refunded (payment is ${payment.status})`);
    if (!supportsWalletRefund(payment.network)) {
      throw validationError(`prepared refunds are not available on ${payment.network}; send it from your wallet and record the transaction`);
    }
    const to = body.to ?? (await payerAddressFor(ctx, payment));
    if (!to) throw validationError("SettleKit does not know the buyer's wallet for this payment; enter the address to refund", { fields: ["to"] });
    assertDestination(payment.network, to);
    const amount = body.amountUsd ?? (await ctx.refunds.remainingRefundable(payment)).amount;
    const pending = unwrapResult(
      await ctx.refunds.create({ payment, customerId: payment.customerId, amount, reason: body.reason }),
    );
    const plan = refundPlan(payment.network, to, pending.amount.amount, pending.id);
    const refund = await ctx.refundStore.save({
      ...pending,
      destination: to,
      network: payment.network,
      source: "wallet",
      ...(plan.solana ? { reference: plan.solana.reference } : {}),
    });
    return created(c, { refund, plan });
  });

  // Refund to payer, step 2: verify the signed transfer onchain, then settle.
  app.post("/refunds/:id/confirm", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, confirmRefundSchema);
    const refund = await ctx.refundStore.findById(c.req.param("id"));
    const payment = refund ? await ctx.payments.findById(refund.paymentId) : null;
    requireOwned(c, payment, "refund", c.req.param("id"));
    if (!refund || !payment) throw notFound("refund not found");
    if (refund.status === "succeeded") return data(c, { refund, payment: await buildPaymentDetail(ctx, payment) });
    if (refund.status !== "pending" || !refund.destination) throw conflict(`this refund is ${refund.status} and cannot be confirmed`);
    const txHash = requireTxHash(payment.network, body.txHash);
    await assertTxHashUnused(ctx, txHash);
    const reused = (await ctx.refundStore.listAll()).find((r) => r.id !== refund.id && r.txHash === txHash);
    if (reused) throw conflict("this transaction already settled another refund", { refundId: reused.id });
    await verifyOnChainOrThrow(ctx, {
      network: payment.network,
      txHash,
      amount: refund.amount.amount,
      asset: refund.amount.currency,
      payTo: refund.destination,
      resource: `refund:${refund.id}`,
      notBefore: refund.createdAt,
      ...(refund.reference ? { reference: refund.reference } : {}),
    });
    const settled = await settleRefund(ctx, payment, refund, { txHash, revokeAccess: body.revokeAccess, source: "wallet" });
    const updated = await ctx.payments.findById(payment.id);
    return data(c, { refund: settled, payment: await buildPaymentDetail(ctx, updated ?? payment) });
  });

  app.post("/refunds/:id/cancel", async (c) => {
    const ctx = c.get("ctx");
    const refund = await ctx.refundStore.findById(c.req.param("id"));
    const payment = refund ? await ctx.payments.findById(refund.paymentId) : null;
    requireOwned(c, payment, "refund", c.req.param("id"));
    if (!refund) throw notFound("refund not found");
    if (refund.status !== "pending") throw conflict(`this refund is ${refund.status}`);
    return data(c, unwrapResult(await ctx.refunds.markFailed(refund.id, "canceled by the merchant")));
  });

  app.get("/products", async (c) => {
    const ctx = c.get("ctx");
    const org = requireOrg(c);
    const products = await ctx.products.list((p) => p.organizationId === org && !isInvoiceProduct(p));
    const views = await Promise.all(products.map((p) => productView(ctx, p)));
    return data(c, views.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  });

  app.post("/products", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, quickProductSchema);
    await assertCanCreateProduct(ctx, requireOrg(c));
    const product = await createQuickProduct(ctx, requireOrg(c), body);
    return created(c, await productView(ctx, product));
  });

  app.get("/products/:id", async (c) => {
    return data(c, await productView(c.get("ctx"), await ownedProduct(c, c.req.param("id"))));
  });

  app.patch("/products/:id", async (c) => {
    const ctx = c.get("ctx");
    const product = await ownedProduct(c, c.req.param("id"));
    const body = await parseBody(c, productPatchSchema);
    if (body.status === "active" && product.status !== "active") await assertCanCreateProduct(ctx, product.organizationId);
    return data(c, await productView(ctx, await updateProduct(ctx, product, body)));
  });

  app.get("/customers", async (c) => {
    return data(c, await listCustomers(c.get("ctx"), requireOrg(c)));
  });

  app.get("/balances", async (c) => {
    const profile = await loadProfile(c.get("ctx"), requireOrg(c));
    return data(c, await readBalances(profile.payToByNetwork));
  });

  // Cash out to a bank: partner sell links prefilled with the merchant's own
  // wallet (no custody). Empty when no partner key is configured.
  app.get("/offramp", async (c) => {
    const profile = await loadProfile(c.get("ctx"), requireOrg(c));
    const network = c.req.query("network") ?? "";
    const amount = c.req.query("amount") ?? "";
    if (!isPaymentNetwork(network)) throw validationError("network is required", { fields: ["network"] });
    const wallet = profile.payToByNetwork[network];
    if (!wallet) throw validationError(`you have no receiving wallet on ${network}`, { fields: ["network"] });
    const returnUrl = process.env.DASHBOARD_PUBLIC_URL ? `${process.env.DASHBOARD_PUBLIC_URL.replace(/\/+$/, "")}/payouts` : undefined;
    return data(c, {
      network,
      amount,
      wallet,
      configured: configuredOfframps(),
      links: offrampLinks({ network, amount, wallet, ...(returnUrl ? { returnUrl } : {}) }),
    });
  });

  return app;
}
