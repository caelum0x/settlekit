/**
 * Inbound Circle webhook receiver (PUBLIC — authenticated by Circle's ECDSA
 * signature, not an API key).
 *
 *   POST /v1/circle/webhooks
 *
 * Verifies `X-Circle-Signature` (ECDSA-SHA256) against the public key for
 * `X-Circle-Key-Id`, dedupes by `notificationId`, and settles payouts in real
 * time: a `transactions.*` event carrying our `refId` (the payout id) + a
 * `txHash` marks the payout paid; a terminal failure marks it failed. This is
 * the push complement to the worker's `payout-reconcile` poll (which remains as
 * a safety-net fallback). Returns 200 even on no-op so Circle does not retry.
 */
import { Hono } from "hono";
import { SettleKitError } from "@settlekit/common";
import {
  verifyCircleSignature,
  parseCircleNotification,
  extractTransaction,
} from "@settlekit/webhooks";
import type { AppEnv } from "../context.js";
import { data } from "../http/respond.js";

const SETTLED_STATE = "COMPLETE";
const FAILED_STATES = new Set(["FAILED", "CANCELLED", "DENIED"]);

/** Per-instance dedupe of processed Circle notification ids. */
const processed = new Set<string>();
const MAX_PROCESSED = 10_000;

function remember(notificationId: string): boolean {
  if (processed.has(notificationId)) return false;
  if (processed.size >= MAX_PROCESSED) processed.clear();
  processed.add(notificationId);
  return true;
}

export function circleWebhookRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/webhooks", async (c) => {
    const ctx = c.get("ctx");
    if (!ctx.circleWebhookKeys) {
      throw new SettleKitError({
        code: "validation_error",
        message: "Circle webhooks are not configured; set CIRCLE_WALLETS_API_KEY",
      });
    }

    const raw = await c.req.text();
    const keyId = c.req.header("X-Circle-Key-Id");
    const signature = c.req.header("X-Circle-Signature");
    if (!keyId || !signature) {
      throw new SettleKitError({
        code: "unauthorized",
        message: "missing X-Circle-Key-Id / X-Circle-Signature",
        httpStatus: 401,
      });
    }

    const publicKey = await ctx.circleWebhookKeys.getPublicKey(keyId);
    if (!verifyCircleSignature(raw, signature, publicKey)) {
      throw new SettleKitError({
        code: "unauthorized",
        message: "invalid Circle webhook signature",
        httpStatus: 401,
      });
    }

    const notification = parseCircleNotification(raw);
    if (!notification) {
      throw new SettleKitError({ code: "validation_error", message: "invalid notification body" });
    }

    // Idempotent: ignore a notification id we've already handled.
    if (notification.notificationId && !remember(notification.notificationId)) {
      return data(c, { ok: true, deduped: true });
    }

    let settled = false;
    if (notification.notificationType?.startsWith("transactions")) {
      const tx = extractTransaction(notification);
      if (tx?.refId) {
        const payout = await ctx.payoutStore.findById(tx.refId);
        if (payout && payout.status === "pending") {
          if (tx.txHash && tx.state === SETTLED_STATE) {
            const result = await ctx.payouts.markPaid(tx.refId, tx.txHash);
            settled = result.ok;
          } else if (FAILED_STATES.has(tx.state ?? "")) {
            await ctx.payouts.markFailed(tx.refId, `provider transfer ${(tx.state ?? "").toLowerCase()}`);
          }
        }
      }
    }

    return data(c, { ok: true, settled });
  });

  return app;
}
