/**
 * Dunning email job.
 *
 * For subscriptions in `in_grace` or `past_due` — i.e. a renewal payment is
 * overdue — send the buyer a dunning email asking them to update payment before
 * access is revoked. Each tick over a still-delinquent subscription advances a
 * per-subscription attempt counter and sends one email per attempt, keyed by
 * `${subscriptionId}:${attempt}` so a tick is idempotent. Once the subscription
 * leaves the delinquent states (renewed, canceled, or expired) the attempt
 * counter is cleared so a future delinquency starts a fresh dunning sequence.
 */

import { escapeHtml, htmlLayout, htmlRow, textBlock, textLine } from "@settlekit/notifications";
import type { Customer, Subscription } from "@settlekit/common";
import { errorMessage } from "../logger.js";
import { resolveCustomer, resolveMerchant } from "./email-helpers.js";
import type { Job, JobContext, JobResult } from "./types.js";

const DELINQUENT: ReadonlyArray<Subscription["status"]> = ["in_grace", "past_due"];

function buildBody(customer: Customer, subscription: Subscription, attempt: number): { html: string; text: string } {
  const greeting = customer.name ? `Hi ${customer.name},` : "Hi,";
  const graceEnds = subscription.graceEndsAt ? new Date(subscription.graceEndsAt).toISOString().slice(0, 10) : "soon";

  const html = htmlLayout({
    title: "Action needed: payment overdue",
    body: [
      '<h1 style="font-size:20px;margin:0 0 4px">Your payment is overdue</h1>',
      `<p style="font-size:14px;color:#3f3f46;margin:0 0 16px">${escapeHtml(greeting)} ` +
        "we were unable to confirm your renewal payment. Please update your payment to keep your access.</p>",
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">',
      htmlRow("Status", subscription.status),
      htmlRow("Access ends", graceEnds),
      htmlRow("Reminder", `#${attempt}`),
      "</table>",
    ].join("\n"),
    footer: "If you have already paid, you can ignore this message.",
  });

  const text = textBlock([
    `${greeting} we were unable to confirm your renewal payment. Please update your payment to keep your access.`,
    [
      textLine("Status", subscription.status),
      textLine("Access ends", graceEnds),
      textLine("Reminder", `#${attempt}`),
    ].join("\n"),
    "If you have already paid, you can ignore this message.",
  ]);

  return { html, text };
}

export const dunningEmailJob: Job = {
  name: "dunning-email",
  async run(ctx: JobContext): Promise<JobResult> {
    let processed = 0;
    let failed = 0;

    for (const subscription of await ctx.stores.allSubscriptions()) {
      if (!DELINQUENT.includes(subscription.status)) {
        // No longer delinquent — reset the sequence for any future lapse.
        await ctx.stores.clearDunningAttempt(subscription.id);
        continue;
      }

      const attempt = ((await ctx.stores.getDunningAttempt(subscription.id)) ?? 0) + 1;
      const key = `${subscription.id}:${attempt}`;
      if (await ctx.stores.hasSentEmail("dunning", key)) continue;

      const customer = await resolveCustomer(ctx, subscription.customerId);
      if (!customer) {
        ctx.logger.warn("dunning email skipped; no customer contact on record", {
          subscriptionId: subscription.id,
          customerId: subscription.customerId,
        });
        continue;
      }

      const merchant = await resolveMerchant(ctx, subscription.organizationId);

      try {
        const { html, text } = buildBody(customer, subscription, attempt);
        const result = await ctx.email.send({
          to: customer.email,
          subject: merchant ? `Action needed for your ${merchant.displayName} subscription` : "Action needed: payment overdue",
          html,
          text,
          ...(merchant?.supportEmail ? { replyTo: merchant.supportEmail } : {}),
          tags: [
            { name: "type", value: "dunning" },
            { name: "subscription_id", value: subscription.id },
            { name: "attempt", value: String(attempt) },
          ],
        });

        await ctx.stores.markEmailSent("dunning", key);
        await ctx.stores.setDunningAttempt(subscription.id, attempt);
        processed += 1;
        ctx.logger.info("dunning email sent", {
          subscriptionId: subscription.id,
          attempt,
          to: customer.email,
          messageId: result.id,
        });
      } catch (error) {
        failed += 1;
        ctx.logger.error("dunning email failed", {
          subscriptionId: subscription.id,
          attempt,
          error: errorMessage(error),
        });
      }
    }

    return { processed, failed };
  },
};
