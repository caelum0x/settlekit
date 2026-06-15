/**
 * Renewal reminder job.
 *
 * For every active subscription whose `currentPeriodEnd` falls within the
 * configured reminder window (`renewalReminderDays`), send the buyer a single
 * reminder per period. Idempotency is keyed by `${subscriptionId}:${periodEnd}`
 * so the reminder is sent at most once for a given billing period, and a fresh
 * reminder is sent again after the subscription renews into its next period.
 *
 * The reminder body is composed from the package's pure HTML/text primitives
 * (`htmlLayout`, `htmlRow`, `textBlock`, `textLine`) — the same primitives the
 * receipt/access renderers build on — and sent through the real `EmailClient`.
 */

import { escapeHtml, formatUsdc, htmlLayout, htmlRow, textBlock, textLine } from "@settlekit/notifications";
import { addDays, type Customer, type Subscription } from "@settlekit/common";
import { errorMessage } from "../logger.js";
import { resolveCustomer, resolveMerchant } from "./email-helpers.js";
import type { Job, JobContext, JobResult } from "./types.js";

function reminderKey(subscription: Subscription): string {
  return `${subscription.id}:${subscription.currentPeriodEnd}`;
}

/** True when the period ends in the future but within `withinDays` of `now`. */
function dueWithin(periodEndIso: string, now: Date, withinDays: number): boolean {
  const periodEnd = new Date(periodEndIso).getTime();
  const windowOpensAt = addDays(now, withinDays).getTime();
  return periodEnd > now.getTime() && periodEnd <= windowOpensAt;
}

function buildBody(customer: Customer, periodEndIso: string, amount: string, currency: string): { html: string; text: string } {
  const greeting = customer.name ? `Hi ${customer.name},` : "Hi,";
  const renewsOn = new Date(periodEndIso).toISOString().slice(0, 10);

  const html = htmlLayout({
    title: "Your subscription renews soon",
    body: [
      '<h1 style="font-size:20px;margin:0 0 4px">Your subscription renews soon</h1>',
      `<p style="font-size:14px;color:#3f3f46;margin:0 0 16px">${escapeHtml(greeting)} ` +
        "this is a heads-up that your subscription is about to renew.</p>",
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">',
      htmlRow("Renews on", renewsOn),
      htmlRow("Amount", formatUsdc(amount, currency)),
      "</table>",
    ].join("\n"),
    footer: "No action is needed if your payment method is up to date.",
  });

  const text = textBlock([
    `${greeting} this is a heads-up that your subscription is about to renew.`,
    [textLine("Renews on", renewsOn), textLine("Amount", formatUsdc(amount, currency))].join("\n"),
    "No action is needed if your payment method is up to date.",
  ]);

  return { html, text };
}

export const renewalReminderJob: Job = {
  name: "renewal-reminder",
  async run(ctx: JobContext): Promise<JobResult> {
    const now = ctx.now();
    const withinDays = ctx.config.renewalReminderDays;
    let processed = 0;
    let failed = 0;

    for (const subscription of await ctx.stores.allSubscriptions()) {
      if (subscription.status !== "active") continue;
      if (subscription.cancelAtPeriodEnd) continue;
      if (!dueWithin(subscription.currentPeriodEnd, now, withinDays)) continue;

      const key = reminderKey(subscription);
      if (await ctx.stores.hasSentEmail("renewal_reminder", key)) continue;

      const customer = await resolveCustomer(ctx, subscription.customerId);
      if (!customer) {
        ctx.logger.warn("renewal reminder skipped; no customer contact on record", {
          subscriptionId: subscription.id,
          customerId: subscription.customerId,
        });
        continue;
      }

      const merchant = await resolveMerchant(ctx, subscription.organizationId);
      // Surface the most recent confirmed charge amount where known; otherwise 0.
      const lastPayment = (await ctx.stores.confirmedPaymentsByCustomer(subscription.customerId))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .at(0);
      const amount = lastPayment?.amount.amount ?? "0";
      const currency = lastPayment?.amount.currency ?? "USDC";

      try {
        const { html, text } = buildBody(customer, subscription.currentPeriodEnd, amount, currency);
        const result = await ctx.email.send({
          to: customer.email,
          subject: merchant ? `Your ${merchant.displayName} subscription renews soon` : "Your subscription renews soon",
          html,
          text,
          ...(merchant?.supportEmail ? { replyTo: merchant.supportEmail } : {}),
          tags: [
            { name: "type", value: "renewal_reminder" },
            { name: "subscription_id", value: subscription.id },
          ],
        });

        await ctx.stores.markEmailSent("renewal_reminder", key);
        processed += 1;
        ctx.logger.info("renewal reminder sent", {
          subscriptionId: subscription.id,
          to: customer.email,
          messageId: result.id,
        });
      } catch (error) {
        failed += 1;
        ctx.logger.error("renewal reminder failed", {
          subscriptionId: subscription.id,
          error: errorMessage(error),
        });
      }
    }

    return { processed, failed };
  },
};
