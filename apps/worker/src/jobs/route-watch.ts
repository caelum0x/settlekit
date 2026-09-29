/**
 * Any-token route watcher (every 20 s by default).
 *
 * For open checkout sessions with a route in flight (`session.route`, written
 * by the checkout when the buyer accepted a Relay / LI.FI quote), this job
 * polls the route provider. When the provider reports a destination fill it
 * runs the session network's FAIL-CLOSED verifier on that fill:
 *
 *   Transfer of the session's stablecoin to payTo, >= the amount owed, no
 *   earlier than the session's creation, tx hash not used by another payment.
 *
 * Only a verified fill is recorded (as a confirmed payment); the checkout
 * completes the session and fulfils it on its next confirm of the same hash
 * (buyer's status poll or page reload). A provider "success" whose fill does
 * not verify leaves the session unpaid and is logged for support. Fills that
 * are found but not yet deep enough are retried on later ticks.
 *
 * The job never writes checkout sessions (the checkout owns them), so it keeps
 * in-memory backoff for fills that did not verify. No network calls unless
 * ROUTING_ENABLED and a session has a route.
 */

import { confirmPayment, recordPendingPayment } from "@settlekit/payments";
import type { CheckoutRoute, CheckoutSession } from "@settlekit/common";
import { applyRouteStatus, isRouteTerminal, routeDestinationFor } from "@settlekit/routing";
import { isEvmNetwork } from "@settlekit/chains";
import { errorMessage } from "../logger.js";
import { verifyPaymentOnChain } from "./payment-verification.js";
import type { Job, JobContext, JobResult } from "./types.js";

/** Stop watching a route this long after it was quoted. */
export const ROUTE_WATCH_WINDOW_MS = 6 * 60 * 60 * 1000;
/** Re-check a fill that did not verify at most this often. */
export const UNVERIFIED_RETRY_MS = 10 * 60 * 1000;

const unverified = new Map<string, number>();
const refundsLogged = new Set<string>();

/** Test hook: forget remembered unverified fills and logged refunds. */
export function resetRouteWatchState(): void {
  unverified.clear();
  refundsLogged.clear();
}

function watchable(session: CheckoutSession, now: Date): session is CheckoutSession & { route: CheckoutRoute } {
  const route = session.route;
  if (route === undefined || route.network !== session.network) return false;
  if (route.state === "refund" || route.state === "failure") return false;
  return now.getTime() <= new Date(route.quotedAt).getTime() + ROUTE_WATCH_WINDOW_MS;
}

function destinationEnv(ctx: JobContext, session: CheckoutSession): "mainnet" | "testnet" {
  const network = session.network;
  if (isEvmNetwork(network)) return ctx.config.evm.enabled[network]?.spec.env ?? ctx.config.evm.env;
  if (network === "hypercore") return ctx.config.hypercore?.network ?? "mainnet";
  if (network === "solana") return ctx.config.solana?.cluster === "devnet" ? "testnet" : "mainnet";
  return "mainnet";
}

async function currentRoute(ctx: JobContext, session: CheckoutSession & { route: CheckoutRoute }): Promise<CheckoutRoute | null> {
  const route = session.route;
  if (isRouteTerminal(route)) return route;
  const router = ctx.router;
  if (router === undefined) return null;
  const network = session.network;
  const tokenAddress = isEvmNetwork(network) ? ctx.config.evm.enabled[network]?.tokenAddress : undefined;
  const destination = routeDestinationFor(network, { env: destinationEnv(ctx, session), ...(tokenAddress ? { tokenAddress } : {}) });
  if (!destination.ok) return null;
  const status = await router.status({
    provider: route.provider,
    requestId: route.requestId,
    originChainId: route.originChainId,
    destination: destination.destination,
    ...(route.originTxHash !== undefined ? { originTxHash: route.originTxHash } : {}),
  });
  return applyRouteStatus(route, status, ctx.now());
}

/** Verify the fill and record it as a confirmed payment. Returns true when recorded. */
async function settleFill(ctx: JobContext, session: CheckoutSession, route: CheckoutRoute & { destinationTxHash: string }): Promise<boolean> {
  const hash = route.destinationTxHash;
  const owner = await ctx.stores.paymentByTxHash(hash);
  if (owner) {
    if (owner.checkoutSessionId !== session.id) {
      ctx.logger.warn("route fill already backs another payment; not paying this session", { sessionId: session.id, txHash: hash, paymentId: owner.id });
    }
    return false;
  }
  const retryAt = unverified.get(hash);
  if (retryAt !== undefined && retryAt > ctx.now().getTime()) return false;

  const pending = recordPendingPayment(
    {
      organizationId: session.organizationId,
      checkoutSessionId: session.id,
      customerId: session.customerId ?? `cus_${session.id}`,
      amount: session.amount,
      network: session.network,
      txHash: hash,
    },
    ctx.now(),
  );
  // Verify against the session as the checkout stored it plus the provider's fill.
  const verification = await verifyPaymentOnChain(ctx, pending, hash, { ...session, route });
  if (verification.status === "confirmed") {
    const confirmed = confirmPayment(pending, hash, verification.confirmations, verification.minConfirmations, ctx.now());
    await ctx.stores.upsertPayment(confirmed);
    unverified.delete(hash);
    ctx.logger.info("route fill verified; payment confirmed", { sessionId: session.id, provider: route.provider, txHash: hash });
    return true;
  }
  if (verification.status === "pending" && (verification.retryable || verification.claimable)) {
    ctx.logger.debug("route fill not final yet", { sessionId: session.id, txHash: hash, reason: verification.reason });
    return false;
  }
  unverified.set(hash, ctx.now().getTime() + UNVERIFIED_RETRY_MS);
  ctx.logger.warn("route provider reported a fill that does not pay the session; unpaid", {
    sessionId: session.id,
    provider: route.provider,
    requestId: route.requestId,
    txHash: hash,
    reason: verification.reason,
  });
  return false;
}

export const routeWatchJob: Job = {
  name: "route-watch",
  async run(ctx: JobContext): Promise<JobResult> {
    if (ctx.router === undefined) return { processed: 0, failed: 0 };
    const now = ctx.now();
    const sessions = (await ctx.stores.openCheckoutSessions()).filter((session) => watchable(session, now));
    let processed = 0;
    let failed = 0;
    for (const session of sessions) {
      try {
        const route = await currentRoute(ctx, session);
        if (route === null) continue;
        if (route.state === "refund") {
          if (refundsLogged.has(route.requestId)) continue;
          refundsLogged.add(route.requestId);
          ctx.logger.info("route refunded to the buyer", { sessionId: session.id, refundTxHash: route.refundTxHash, refundTo: route.originAddress });
          continue;
        }
        if (route.state !== "success") continue;
        if (route.destinationTxHash === undefined) {
          ctx.logger.warn("route provider reported success without a destination transaction; unpaid", { sessionId: session.id });
          continue;
        }
        if (await settleFill(ctx, session, route as CheckoutRoute & { destinationTxHash: string })) processed += 1;
      } catch (error) {
        failed += 1;
        ctx.logger.error("route watch failed", { sessionId: session.id, error: errorMessage(error) });
      }
    }
    return { processed, failed };
  },
};
