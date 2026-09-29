/**
 * Payment routes (plan §15, §14).
 *
 * The core money + access flow:
 *   1. POST /v1/payments           — record a pending payment for a session.
 *   2. POST /v1/payments/:id/confirm — confirm it (>= min confirmations). On
 *      confirmation the checkout session is completed and an entitlement is
 *      granted for each line item's product via `EntitlementService.grantFromPayment`.
 *   3. POST /v1/payments/:id/refund  — refund a confirmed payment.
 *
 * Every transition uses the real `@settlekit/payments` lifecycle functions and
 * persists through the in-memory repositories.
 */
import { Hono } from "hono";
import { z } from "zod";
import { conflict, money, validationError, type Entitlement, type Money } from "@settlekit/common";
import {
  confirmPayment,
  failPayment,
  recordPendingPayment,
  refundPayment,
} from "@settlekit/payments";
import { completeSession } from "@settlekit/payments";
import { paymentConfirmedWebhook } from "@settlekit/persistence";
import type { AppEnv, AppContext } from "../context.js";
import { emitWebhook } from "../webhooks/outbox.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { requireOrg, requireOwned, requireOwnedPayment } from "../http/tenant.js";
import { screenAddressOrThrow } from "../compliance/screen.js";
import { checkPayTo, isValidTxHash, txHashFormatHint } from "@settlekit/chains";
import {
  assertTxHashUnused,
  requireTxHash,
  requireVerifier,
  sessionCheck,
  verifyOnChainOrThrow,
} from "./payment-verification.js";

const recordSchema = z.object({
  checkoutSessionId: z.string().min(1),
  txHash: z.string().optional(),
});

const confirmSchema = z.object({
  txHash: z.string().min(1),
  confirmations: z.number().int().nonnegative(),
  minConfirmations: z.number().int().positive().optional(),
});

/**
 * Networks a direct deposit can be observed on. Zcash is excluded: its
 * amount is only meaningful against a checkout session's locked quote.
 */
const OBSERVABLE_NETWORKS = [
  "solana",
  "arc",
  "base",
  "ethereum",
  "arbitrum",
  "robinhood",
  "hyperevm",
  "hypercore",
  "tempo",
] as const;

const observeSchema = z
  .object({
    // Derived from the authenticated org (tenant scope); ignored if supplied.
    organizationId: z.string().min(1).optional(),
    txHash: z.string().min(1),
    /** The watched (recipient) address the transfer landed at. */
    to: z.string().min(1),
    amount: z.string().regex(/^\d+(\.\d+)?$/, "must be a decimal amount"),
    asset: z.enum(["USDC", "EURC", "USYC"]).default("USDC"),
    network: z.enum(OBSERVABLE_NETWORKS).default("arc"),
    /** Sender, if the indexer decoded it; screened when present. */
    from: z.string().optional(),
    /** Optional customer attribution; defaults to a synthetic direct-payment id. */
    customerId: z.string().optional(),
    confirmations: z.number().int().nonnegative().default(0),
  })
  .superRefine((body, ctx) => {
    // Hash/address formats depend on the chain (@settlekit/chains rules).
    if (!isValidTxHash(body.network, body.txHash)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["txHash"], message: `must be ${txHashFormatHint(body.network)}` });
    }
    const to = checkPayTo(body.network, body.to);
    if (!to.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: to.reason });
    if (body.from !== undefined && !checkPayTo(body.network, body.from).ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["from"], message: `must be a valid ${body.network} address` });
    }
  });

export function paymentRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Record a pending payment against a checkout session.
  app.post("/", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, recordSchema);
    // Tenant-scoped: only the caller's own sessions can be paid against.
    const session = requireOwned(
      c,
      await ctx.checkouts.findById(body.checkoutSessionId),
      "checkout session",
      body.checkoutSessionId,
    );
    if (session.customerId === undefined) {
      throw validationError("checkout session has no customer; set customerId before paying", {
        sessionId: session.id,
      });
    }

    const txHash = body.txHash !== undefined ? requireTxHash(session.network, body.txHash) : undefined;
    if (txHash !== undefined) await assertTxHashUnused(ctx, txHash);

    const payment = recordPendingPayment({
      organizationId: session.organizationId,
      checkoutSessionId: session.id,
      customerId: session.customerId,
      amount: session.amount,
      network: session.network,
      ...(txHash !== undefined ? { txHash } : {}),
    });
    return created(c, await ctx.payments.save(payment));
  });

  // List payments for the authenticated organization.
  app.get("/", async (c) => {
    return data(c, await c.get("ctx").payments.listByOrganization(requireOrg(c)));
  });

  // Single-payment routes: owner-only; another org's id answers 404.
  app.get("/:id", async (c) => {
    return data(c, await requireOwnedPayment(c, c.req.param("id")));
  });

  // Confirm a payment: completes the session and grants entitlements.
  app.post("/:id/confirm", async (c) => {
    const ctx = c.get("ctx");
    const payment = await requireOwnedPayment(c, c.req.param("id"));

    const body = await parseBody(c, confirmSchema);

    const session = await ctx.checkouts.findById(payment.checkoutSessionId);
    if (!session) throw conflict("checkout session vanished", { id: payment.checkoutSessionId });

    // Verify the transfer ON-CHAIN before confirming, on EVERY network: the tx
    // must have paid the session's payTo for this network at least the
    // invoiced amount (Zcash: exactly the locked quote), no earlier than the
    // session, from the declared payer, carrying the session's Solana
    // reference / Tempo memo where applicable (a route provider's destination
    // fill stored on the session is bound by payTo, amount and block time
    // instead, matching the checkout and worker). No verifier for the network
    // means the payment cannot be confirmed (fail closed), and a tx hash can
    // back only one payment, so one transfer never settles two sessions.
    requireVerifier(ctx, payment.network);
    const txHash = requireTxHash(payment.network, body.txHash);
    await assertTxHashUnused(ctx, txHash, payment.id);
    await verifyOnChainOrThrow(ctx, sessionCheck(session, payment.network, txHash));

    const confirmed = confirmPayment(
      payment,
      txHash,
      body.confirmations,
      body.minConfirmations,
    );
    const savedPayment = await ctx.payments.save(confirmed);

    // Complete the session (idempotent) and grant entitlements for each product.
    if (session.status === "open") {
      await ctx.checkouts.save(completeSession(session));
    }

    const entitlements = await grantEntitlements(ctx, savedPayment.id);
    await emitWebhook(
      ctx.webhookOutbox,
      paymentConfirmedWebhook(savedPayment, {
        ...(session.collectedFields.email ? { customerEmail: session.collectedFields.email } : {}),
        productIds: session.lineItems.flatMap((line) => (line.productId ? [line.productId] : [])),
      }),
    );
    return data(c, { payment: savedPayment, entitlements });
  });

  // Fail a pending payment.
  app.post("/:id/fail", async (c) => {
    const ctx = c.get("ctx");
    const payment = await requireOwnedPayment(c, c.req.param("id"));
    return data(c, await ctx.payments.save(failPayment(payment)));
  });

  // Refund a confirmed payment.
  app.post("/:id/refund", async (c) => {
    const ctx = c.get("ctx");
    const payment = await requireOwnedPayment(c, c.req.param("id"));
    return data(c, await ctx.payments.save(refundPayment(payment)));
  });

  // Observe a DIRECT on-chain payment: a merchant accepts USDC by sharing an Arc
  // address; the arc-indexer watches it and posts observed Transfers here. We
  // RE-VERIFY the transfer on-chain (never trust the indexer's claim), screen
  // the sender, and record a confirmed payment attributed to the org — which
  // flows into the merchant's withdrawable balance. Idempotent on txHash.
  app.post("/observe", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, observeSchema);
    // Tenant-scoped: credit the authenticated org, never a client-supplied one.
    const organizationId = requireOrg(c);

    // Fail closed: without a verifier for the network nothing can be credited.
    requireVerifier(ctx, body.network);
    const txHash = requireTxHash(body.network, body.txHash);

    // Idempotency: this org already recorded the transfer -> return it. A hash
    // recorded by ANY other payment (another org/session) is a replay -> 409.
    const existing = await ctx.payments.findByTxHash(txHash);
    if (existing) {
      if (existing.organizationId === organizationId && existing.status === "confirmed") {
        return data(c, { payment: existing, deduped: true });
      }
      throw conflict("transaction hash already used by another payment", { txHash, paymentId: existing.id });
    }

    // Independently re-verify the transfer on-chain via the network's verifier
    // (the same one the checkout-confirm path uses). This enforces recipient +
    // amount (+ confirmations on EVM) against the chain, so a spoofed
    // `observe` body is rejected.
    await verifyOnChainOrThrow(ctx, {
      network: body.network,
      txHash,
      amount: body.amount,
      asset: body.asset,
      payTo: body.to,
      resource: `observe:${txHash}`,
      ...(body.from !== undefined ? { from: body.from } : {}),
    });

    // Screen the sender (when decoded) before crediting the merchant.
    if (body.from) {
      await screenAddressOrThrow(
        { screening: ctx.screening, defaultChain: ctx.complianceDefaultChain },
        { address: body.from, network: body.network, context: `observe:${txHash}` },
      );
    }

    const amount = { amount: money(body.amount).amount, currency: body.asset } as unknown as Money;
    const pending = recordPendingPayment({
      organizationId,
      checkoutSessionId: `direct:${txHash}`,
      customerId: body.customerId ?? `direct:${body.from ?? "unknown"}`,
      amount,
      network: body.network,
      txHash,
    });
    // The on-chain verifier already enforced confirmations; mark confirmed.
    const settled = confirmPayment(pending, txHash, Math.max(body.confirmations, 1), 1);
    const saved = await ctx.payments.save(settled);
    await emitWebhook(ctx.webhookOutbox, paymentConfirmedWebhook(saved));
    return created(c, { payment: saved, deduped: false });
  });

  return app;
}

/**
 * Grant one entitlement per line-item product on a confirmed payment. Resolves
 * the product for each item from the product store and delegates to the real
 * `EntitlementService.grantFromPayment`.
 */
async function grantEntitlements(ctx: AppContext, paymentId: string): Promise<Entitlement[]> {
  const payment = await ctx.payments.findById(paymentId);
  if (!payment) return [];
  const session = await ctx.checkouts.findById(payment.checkoutSessionId);
  if (!session) return [];

  const granted: Entitlement[] = [];
  for (const item of session.lineItems) {
    if (item.productId === undefined) continue;
    const product = await ctx.products.findById(item.productId);
    if (!product) continue;
    const price = await ctx.prices.findById(item.priceId);
    const entitlement = await ctx.entitlements.grantFromPayment({
      payment,
      product,
      ...(price?.creditsGranted !== undefined ? { creditsRemaining: price.creditsGranted } : {}),
    });
    granted.push(entitlement);
  }
  return granted;
}
