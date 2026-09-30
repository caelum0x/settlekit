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
import { conflict, money, validationError, type Product } from "@settlekit/common";
import { isValidTxHash } from "@settlekit/chains";
import { refundPayment } from "@settlekit/payments";
import type { AppEnv } from "../context.js";
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

const refundSchema = z.object({
  reason: z.enum(["duplicate", "fraudulent", "customer_request", "delivery_failed"]).default("customer_request"),
  /** Partial refund amount in USD; defaults to the full payment. */
  amountUsd: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
  /** Transaction that sent the funds back from the merchant's wallet. */
  txHash: z.string().trim().min(1).optional(),
  revokeAccess: z.boolean().default(true),
});

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
    const settled = unwrapResult(await ctx.refunds.markSucceeded(pending.id));
    const refund = body.txHash ? await ctx.refundStore.save({ ...settled, txHash: body.txHash }) : settled;
    const full = money(amount).amount === money(payment.amount.amount).amount;
    if (full) await ctx.payments.save(refundPayment(payment));
    if (body.revokeAccess) {
      const granted = (await ctx.entitlementRepo.listByCustomer(payment.customerId)).filter(
        (e) => e.grantedBy.type === "payment" && e.grantedBy.id === payment.id && e.status !== "revoked",
      );
      for (const e of granted) await ctx.entitlements.revoke(e.id, `refunded (${body.reason})`);
    }
    await emitWebhook(
      ctx.webhookOutbox,
      refundSucceededWebhook({ refundId: refund.id, payment, amount, reason: body.reason, txHash: body.txHash ?? null, source: "manual" }),
    );
    const updated = await ctx.payments.findById(payment.id);
    return data(c, { refund, payment: await buildPaymentDetail(ctx, updated ?? payment) });
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
    return data(c, await productView(ctx, await updateProduct(ctx, product, body)));
  });

  app.get("/customers", async (c) => {
    return data(c, await listCustomers(c.get("ctx"), requireOrg(c)));
  });

  app.get("/balances", async (c) => {
    const profile = await loadProfile(c.get("ctx"), requireOrg(c));
    return data(c, await readBalances(profile.payToByNetwork));
  });

  return app;
}
