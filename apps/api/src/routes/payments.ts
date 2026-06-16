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
import { conflict, money, notFound, validationError, type Entitlement, type Money } from "@settlekit/common";
import {
  confirmPayment,
  failPayment,
  recordPendingPayment,
  refundPayment,
} from "@settlekit/payments";
import { completeSession } from "@settlekit/payments";
import { X402_SCHEME } from "@settlekit/x402";
import type { AppEnv, AppContext } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { requireOrg } from "../http/tenant.js";
import { screenAddressOrThrow } from "../compliance/screen.js";

const recordSchema = z.object({
  checkoutSessionId: z.string().min(1),
  txHash: z.string().optional(),
});

const confirmSchema = z.object({
  txHash: z.string().min(1),
  confirmations: z.number().int().nonnegative(),
  minConfirmations: z.number().int().positive().optional(),
});

const observeSchema = z.object({
  // Derived from the authenticated org (tenant scope); ignored if supplied.
  organizationId: z.string().min(1).optional(),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "must be a 0x tx hash"),
  /** The watched (recipient) address the transfer landed at. */
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x address"),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "must be a decimal amount"),
  asset: z.enum(["USDC", "EURC", "USYC"]).default("USDC"),
  network: z.enum(["arc", "base", "ethereum"]).default("arc"),
  /** Sender, if the indexer decoded it; screened when present. */
  from: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  /** Optional customer attribution; defaults to a synthetic direct-payment id. */
  customerId: z.string().optional(),
  confirmations: z.number().int().nonnegative().default(0),
});

export function paymentRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Record a pending payment against a checkout session.
  app.post("/", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, recordSchema);
    const session = await ctx.checkouts.findById(body.checkoutSessionId);
    if (!session) throw notFound("checkout session not found", { id: body.checkoutSessionId });
    if (session.customerId === undefined) {
      throw validationError("checkout session has no customer; set customerId before paying", {
        sessionId: session.id,
      });
    }

    const payment = recordPendingPayment({
      organizationId: session.organizationId,
      checkoutSessionId: session.id,
      customerId: session.customerId,
      amount: session.amount,
      network: session.network,
      ...(body.txHash !== undefined ? { txHash: body.txHash } : {}),
    });
    return created(c, await ctx.payments.save(payment));
  });

  // List payments for the authenticated organization.
  app.get("/", async (c) => {
    return data(c, await c.get("ctx").payments.listByOrganization(requireOrg(c)));
  });

  app.get("/:id", async (c) => {
    const payment = await c.get("ctx").payments.findById(c.req.param("id"));
    if (!payment) throw notFound("payment not found", { id: c.req.param("id") });
    return data(c, payment);
  });

  // Confirm a payment: completes the session and grants entitlements.
  app.post("/:id/confirm", async (c) => {
    const ctx = c.get("ctx");
    const id = c.req.param("id");
    const payment = await ctx.payments.findById(id);
    if (!payment) throw notFound("payment not found", { id });

    const body = await parseBody(c, confirmSchema);

    const session = await ctx.checkouts.findById(payment.checkoutSessionId);
    if (!session) throw conflict("checkout session vanished", { id: payment.checkoutSessionId });

    // When Arc settlement is configured, verify the transfer ON-CHAIN before
    // confirming an Arc-network payment: the tx must have moved at least the
    // invoiced USDC to the session's payTo address with enough confirmations.
    // This prevents a caller from settling a session with an arbitrary hash.
    // (Non-Arc networks / unconfigured Arc fall through to the recorded count.)
    if (ctx.arcVerifier && payment.network === "arc") {
      const verification = await ctx.arcVerifier(
        {
          txHash: body.txHash,
          from: "",
          amount: session.amount.amount,
          network: payment.network,
          nonce: "",
        },
        {
          scheme: X402_SCHEME,
          amount: session.amount.amount,
          asset: session.amount.currency,
          network: payment.network,
          payTo: session.payToAddress,
          productId: "",
          resource: `checkout_session:${session.id}`,
          nonce: "",
        },
      );
      if (!verification.ok) {
        throw validationError(`on-chain payment verification failed: ${verification.reason ?? "unverified"}`, {
          paymentId: id,
          txHash: body.txHash,
        });
      }
    }

    const confirmed = confirmPayment(
      payment,
      body.txHash,
      body.confirmations,
      body.minConfirmations,
    );
    const savedPayment = await ctx.payments.save(confirmed);

    // Complete the session (idempotent) and grant entitlements for each product.
    if (session.status === "open") {
      await ctx.checkouts.save(completeSession(session));
    }

    const entitlements = await grantEntitlements(ctx, savedPayment.id);
    return data(c, { payment: savedPayment, entitlements });
  });

  // Fail a pending payment.
  app.post("/:id/fail", async (c) => {
    const ctx = c.get("ctx");
    const payment = await ctx.payments.findById(c.req.param("id"));
    if (!payment) throw notFound("payment not found", { id: c.req.param("id") });
    return data(c, await ctx.payments.save(failPayment(payment)));
  });

  // Refund a confirmed payment.
  app.post("/:id/refund", async (c) => {
    const ctx = c.get("ctx");
    const payment = await ctx.payments.findById(c.req.param("id"));
    if (!payment) throw notFound("payment not found", { id: c.req.param("id") });
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

    if (!ctx.arcVerifier) {
      throw validationError(
        "Arc is not configured; observed transfers cannot be verified (set ARC_CHAIN_ID)",
      );
    }

    // Idempotency: a confirmed payment for this txHash already exists?
    const confirmed = await ctx.payments.findConfirmedByOrganization(organizationId);
    const dupe = confirmed.find((p) => p.txHash === body.txHash);
    if (dupe) return data(c, { payment: dupe, deduped: true });

    // Independently re-verify the transfer on-chain via the same Arc verifier
    // the checkout-confirm path uses. This enforces recipient + amount +
    // confirmations against the chain, so a spoofed `observe` body is rejected.
    const verification = await ctx.arcVerifier(
      { txHash: body.txHash, from: body.from ?? "", amount: body.amount, network: body.network, nonce: "" },
      {
        scheme: X402_SCHEME,
        amount: body.amount,
        // The verifier widens asset to string at runtime to resolve EURC/USYC.
        asset: body.asset as "USDC",
        network: body.network,
        payTo: body.to,
        productId: "",
        resource: `observe:${body.txHash}`,
        nonce: "",
      },
    );
    if (!verification.ok) {
      throw validationError(`on-chain verification failed: ${verification.reason ?? "unverified"}`, {
        txHash: body.txHash,
      });
    }

    // Screen the sender (when decoded) before crediting the merchant.
    if (body.from) {
      await screenAddressOrThrow(
        { screening: ctx.screening, defaultChain: ctx.complianceDefaultChain },
        { address: body.from, network: body.network, context: `observe:${body.txHash}` },
      );
    }

    const amount = { amount: money(body.amount).amount, currency: body.asset } as unknown as Money;
    const pending = recordPendingPayment({
      organizationId,
      checkoutSessionId: `direct:${body.txHash}`,
      customerId: body.customerId ?? `direct:${body.from ?? "unknown"}`,
      amount,
      network: body.network,
      txHash: body.txHash,
    });
    // The on-chain verifier already enforced confirmations; mark confirmed.
    const settled = confirmPayment(pending, body.txHash, Math.max(body.confirmations, 1), 1);
    const saved = await ctx.payments.save(settled);
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
