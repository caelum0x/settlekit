/**
 * Checkout session routes (plan §15, Phase 1).
 *
 * Uses the real `@settlekit/payments` checkout domain: it resolves each line
 * item's `Price` from the price store, computes the total via
 * `createCheckoutSession`, and persists through the in-memory checkout repo.
 * Buyer delivery fields can be merged with `collectFields`; sessions can be
 * canceled/expired through the pure transition functions.
 */
import { Hono } from "hono";
import { z } from "zod";
import { notFound, validationError, PAYMENT_NETWORKS, type CheckoutSession, type PaymentNetwork } from "@settlekit/common";
import { checkPayTo } from "@settlekit/chains";
import {
  cancelSession,
  collectFields,
  createCheckoutSession,
  expireSession,
  type PricedLineItem,
} from "@settlekit/payments";
import { createReference } from "@settlekit/solana";
import type { AppContext, AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { requireOrg } from "../http/tenant.js";
import { payToFor } from "./payment-verification.js";
import { lockZcashQuoteFor } from "./zcash-quote.js";

const NETWORKS = PAYMENT_NETWORKS as unknown as readonly [PaymentNetwork, ...PaymentNetwork[]];

const lineItemSchema = z.object({
  priceId: z.string().min(1),
  productId: z.string().optional(),
  bundleId: z.string().optional(),
  quantity: z.number().int().positive().default(1),
});

const createSchema = z
  .object({
    // Derived from the authenticated org (tenant scope); ignored if supplied.
    organizationId: z.string().min(1).optional(),
    merchantId: z.string().min(1),
    customerId: z.string().optional(),
    items: z.array(lineItemSchema).min(1),
    payToAddress: z.string().min(1),
    network: z.enum(NETWORKS),
    /** Networks the buyer may pick from; must include `network`. */
    acceptedNetworks: z.array(z.enum(NETWORKS)).min(1).optional(),
    /** Per-network payTo (e.g. a Solana wallet and an EVM wallet). */
    payToByNetwork: z.record(z.enum(NETWORKS), z.string().min(1)).optional(),
    /** Tempo: only accept transferWithMemo(keccak256(session id)) payments. */
    requireMemo: z.boolean().optional(),
    successUrl: z.string().url().optional(),
    cancelUrl: z.string().url().optional(),
    collectedFields: z.record(z.string()).optional(),
    ttlDays: z.number().int().positive().optional(),
  })
  .superRefine((body, ctx) => {
    // Every payable network needs a valid destination for ITS chain: funds
    // sent to a malformed address are unrecoverable, and verification matches
    // the recipient exactly.
    const accepted = body.acceptedNetworks ?? [body.network];
    if (!accepted.includes(body.network)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["acceptedNetworks"], message: "must include network" });
    }
    if (new Set(accepted).size !== accepted.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["acceptedNetworks"], message: "must not repeat a network" });
    }
    for (const network of accepted) {
      const payTo = body.payToByNetwork?.[network] ?? body.payToAddress;
      const check = checkPayTo(network, payTo);
      if (!check.ok) {
        const path = body.payToByNetwork?.[network] !== undefined ? ["payToByNetwork", network] : ["payToAddress"];
        ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: check.reason });
      }
    }
    if (body.requireMemo === true && !accepted.includes("tempo")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["requireMemo"], message: "requireMemo applies to Tempo; accept tempo or drop it" });
    }
    for (const network of Object.keys(body.payToByNetwork ?? {}) as PaymentNetwork[]) {
      if (!accepted.includes(network)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payToByNetwork", network], message: "network is not accepted" });
      }
    }
  });

/**
 * Attach per-network payment bindings: a Solana Pay reference when Solana is
 * payable (the paying tx must include it) and a locked ZEC quote when Zcash
 * is payable (the buyer owes exactly that many zatoshis).
 */
async function withNetworkBindings(ctx: AppContext, session: CheckoutSession): Promise<CheckoutSession> {
  const accepted = session.acceptedNetworks ?? [session.network];
  const withReference = accepted.includes("solana") ? { ...session, paymentReference: createReference() } : session;
  if (!accepted.includes("zcash")) return withReference;
  const payTo = payToFor(withReference, "zcash");
  const zcashNetwork = ctx.zcash?.network ?? "mainnet";
  const check = checkPayTo("zcash", payTo, { zcashNetwork });
  if (!check.ok) throw validationError(`invalid Zcash payTo: ${check.reason}`, { network: "zcash" });
  const settlementQuote = await lockZcashQuoteFor(ctx, withReference, payTo);
  return { ...withReference, settlementQuote };
}

const collectSchema = z.object({
  fields: z.record(z.string()),
});

export function checkoutRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, createSchema);

    // Resolve each line item's Price from the price store for total math.
    const priced: PricedLineItem[] = await Promise.all(
      body.items.map(async (item) => {
        const price = await ctx.prices.findById(item.priceId);
        if (!price) {
          throw validationError(`price not found: ${item.priceId}`, { priceId: item.priceId });
        }
        return {
          lineItem: {
            priceId: item.priceId,
            quantity: item.quantity,
            ...(item.productId !== undefined ? { productId: item.productId } : {}),
            ...(item.bundleId !== undefined ? { bundleId: item.bundleId } : {}),
          },
          price,
        };
      }),
    );

    const draft = createCheckoutSession({
      organizationId: requireOrg(c),
      merchantId: body.merchantId,
      ...(body.customerId !== undefined ? { customerId: body.customerId } : {}),
      items: priced,
      payToAddress: body.payToAddress,
      network: body.network as PaymentNetwork,
      ...(body.successUrl !== undefined ? { successUrl: body.successUrl } : {}),
      ...(body.cancelUrl !== undefined ? { cancelUrl: body.cancelUrl } : {}),
      ...(body.collectedFields !== undefined ? { collectedFields: body.collectedFields } : {}),
      ...(body.ttlDays !== undefined ? { ttlDays: body.ttlDays } : {}),
    });
    const session = await withNetworkBindings(ctx, {
      ...draft,
      ...(body.acceptedNetworks !== undefined ? { acceptedNetworks: body.acceptedNetworks } : {}),
      ...(body.payToByNetwork !== undefined ? { payToByNetwork: body.payToByNetwork } : {}),
      ...(body.requireMemo === true ? { requireMemo: true } : {}),
    });

    const saved = await ctx.checkouts.save(session);
    return created(c, saved);
  });

  app.get("/:id", async (c) => {
    const session = await c.get("ctx").checkouts.findById(c.req.param("id"));
    if (!session) throw notFound("checkout session not found", { id: c.req.param("id") });
    return data(c, session);
  });

  // Merge buyer-supplied delivery fields into an open session.
  app.post("/:id/collect-fields", async (c) => {
    const ctx = c.get("ctx");
    const session = await ctx.checkouts.findById(c.req.param("id"));
    if (!session) throw notFound("checkout session not found", { id: c.req.param("id") });
    const body = await parseBody(c, collectSchema);
    const updated = await ctx.checkouts.save(collectFields(session, body.fields));
    return data(c, updated);
  });

  app.post("/:id/cancel", async (c) => {
    const ctx = c.get("ctx");
    const session = await ctx.checkouts.findById(c.req.param("id"));
    if (!session) throw notFound("checkout session not found", { id: c.req.param("id") });
    return data(c, await ctx.checkouts.save(cancelSession(session)));
  });

  app.post("/:id/expire", async (c) => {
    const ctx = c.get("ctx");
    const session = await ctx.checkouts.findById(c.req.param("id"));
    if (!session) throw notFound("checkout session not found", { id: c.req.param("id") });
    return data(c, await ctx.checkouts.save(expireSession(session)));
  });

  return app;
}
