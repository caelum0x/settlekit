/**
 * Seller webhooks raised by worker jobs (payment confirmations the worker
 * observes). Queued through the shared outbox, so a payment the checkout
 * already reported produces no duplicate event.
 */
import type { CheckoutSession, Payment } from "@settlekit/common";
import { emitWebhookSafely, paymentConfirmedWebhook } from "@settlekit/persistence";
import type { JobContext } from "./types.js";

const FORWARDED_FIELDS = ["githubUsername", "discordUserId", "discordUsername"] as const;

export async function emitPaymentConfirmed(ctx: JobContext, payment: Payment, session: CheckoutSession | undefined | null): Promise<void> {
  if (!ctx.webhooks) return;
  const fields = session?.collectedFields ?? {};
  const buyer = Object.fromEntries(FORWARDED_FIELDS.flatMap((key) => (fields[key] ? [[key, fields[key] as string]] : [])));
  await emitWebhookSafely(
    ctx.webhooks,
    paymentConfirmedWebhook(payment, {
      ...(fields.email ? { customerEmail: fields.email } : {}),
      productIds: (session?.lineItems ?? []).flatMap((line) => (line.productId ? [line.productId] : [])),
      buyer,
    }),
  );
}
