/**
 * Renewal invoices for networks without a pull primitive (HyperCore, Zcash,
 * or any buyer who prefers to pay each period by hand).
 *
 * Each due period creates a fresh checkout session (via the real
 * `@settlekit/payments` session factory, persisted through the shared
 * CheckoutRepository) and emails the buyer a link to it. The charge stays
 * `awaiting_payment` until the checkout completes; payment verification is
 * the checkout's normal fail-closed per-network verifier. An expired session
 * counts as a failed charge (dunning then retries with a new invoice).
 */
import { escapeHtml } from "./html.js";
import type { CheckoutSession } from "@settlekit/common";
import { createCheckoutSession, type CheckoutRepository } from "@settlekit/payments";
import type { EmailClient } from "@settlekit/notifications";
import {
  ChargeDeclinedError,
  type ChargeProvider,
  type CollectContext,
  type CollectOutcome,
  type InvoiceStatus,
} from "./provider.js";
import type { OnchainCharge, OnchainSubscription } from "./types.js";

export interface RenewalInvoiceConfig {
  checkouts: Pick<CheckoutRepository, "save" | "findById">;
  email: EmailClient | null;
  /** Public checkout origin; links are `${checkoutBaseUrl}/c/${sessionId}`. */
  checkoutBaseUrl: string;
  merchantId: string;
  /** Days the renewal link stays payable (default 7). */
  ttlDays?: number;
  productName?: (subscription: OnchainSubscription) => Promise<string | undefined>;
  now?: () => Date;
}

export class RenewalInvoiceBilling implements ChargeProvider {
  readonly method = "renewal_invoice" as const;

  constructor(private readonly config: RenewalInvoiceConfig) {}

  linkFor(sessionId: string): string {
    return `${this.config.checkoutBaseUrl.replace(/\/+$/, "")}/c/${encodeURIComponent(sessionId)}`;
  }

  async collect(subscription: OnchainSubscription, context: CollectContext): Promise<CollectOutcome> {
    const email = subscription.grant?.kind === "renewal_invoice" ? subscription.grant.email : subscription.customerEmail;
    if (!email) throw new ChargeDeclinedError("no email on file for renewal invoices");
    const existing = context.charge.invoiceRef ? await this.config.checkouts.findById(context.charge.invoiceRef) : null;
    const session = existing ?? (await this.createSession(subscription, context));
    await this.sendLink(subscription, session, email, context.charge.periodIndex);
    return { status: "awaiting_payment", invoiceRef: session.id };
  }

  private async createSession(subscription: OnchainSubscription, context: CollectContext): Promise<CheckoutSession> {
    const session = createCheckoutSession(
      {
        organizationId: subscription.organizationId,
        merchantId: this.config.merchantId,
        customerId: subscription.customerId,
        items: [
          {
            lineItem: { productId: subscription.productId, priceId: subscription.priceId, quantity: 1 },
            price: {
              id: subscription.priceId,
              productId: subscription.productId,
              amount: subscription.amountDisplay,
              currency: "USDC",
              interval: "monthly",
              usageBased: false,
              active: true,
              createdAt: subscription.createdAt,
            },
          },
        ],
        payToAddress: subscription.payTo,
        network: subscription.network,
        collectedFields: {
          onchainSubscriptionId: subscription.id,
          periodIndex: String(context.charge.periodIndex),
        },
        ttlDays: this.config.ttlDays ?? 7,
      },
      context.now,
    );
    return this.config.checkouts.save(session);
  }

  private async sendLink(subscription: OnchainSubscription, session: CheckoutSession, to: string, periodIndex: number): Promise<void> {
    if (!this.config.email) return;
    const name = (await this.config.productName?.(subscription)) ?? "your subscription";
    const url = this.linkFor(session.id);
    const amount = `${session.amount.amount} ${session.amount.currency}`;
    await this.config.email.send({
      to,
      subject: `Renew ${name}`,
      text: `Your ${name} renewal (period ${periodIndex + 1}) is due: ${amount}. Pay here before ${session.expiresAt}: ${url}`,
      html: `<p>Your <strong>${escapeHtml(name)}</strong> renewal is due: ${escapeHtml(amount)}.</p><p><a href="${escapeHtml(url)}">Pay the renewal</a> before ${escapeHtml(session.expiresAt)}.</p>`,
      tags: [{ name: "kind", value: "renewal_invoice" }],
    });
  }

  async invoiceStatus(_subscription: OnchainSubscription, charge: OnchainCharge): Promise<InvoiceStatus> {
    if (!charge.invoiceRef) return "expired";
    const session = await this.config.checkouts.findById(charge.invoiceRef);
    if (!session) return "expired";
    if (session.status === "completed") return "paid";
    if (session.status === "expired" || session.status === "canceled") return "expired";
    const now = this.config.now?.() ?? new Date();
    return new Date(session.expiresAt).getTime() <= now.getTime() ? "expired" : "open";
  }
}
