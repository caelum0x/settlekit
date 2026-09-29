/**
 * The access side-effects of onchain billing, shared by the API and worker:
 *
 *   collected  -> linked core Subscription active through the paid period,
 *                 a confirmed Payment recorded (pull methods; renewal invoices
 *                 are recorded by the normal checkout flow), entitlements
 *                 extended / re-activated
 *   past_due   -> core Subscription past_due (access kept during dunning)
 *   suspended  -> core Subscription expired, entitlements expired so the
 *                 access-sync job revokes downstream grants
 *
 * On the first successful charge, and when a suspended (expired) subscription
 * is paid again, the product's delivery actions (GitHub / Discord / files /
 * keys) are handed to `queueDelivery` so the app's delivery runner grants the
 * downstream access. A delivery failure never undoes the collected charge.
 *
 * Storage is behind {@link AccessSinks} so each app adapts its own stores.
 */
import { fromBaseUnits, money, type Entitlement, type Payment, type Subscription } from "@settlekit/common";
import type { ChargeEngineHooks } from "./charge-engine.js";
import type { PeriodBounds } from "./period.js";
import type { OnchainCharge, OnchainSubscription } from "./types.js";

export interface AccessSinks {
  getSubscription(id: string): Promise<Subscription | undefined>;
  saveSubscription(subscription: Subscription): Promise<void>;
  entitlementsFor(customerId: string, productId: string): Promise<Entitlement[]>;
  saveEntitlement(entitlement: Entitlement): Promise<void>;
  savePayment(payment: Payment): Promise<void>;
  /** Run / enqueue the product's delivery actions (idempotent per `paymentId`). */
  queueDelivery?(delivery: AccessDelivery): Promise<void>;
  /**
   * A period was collected (seller webhooks). `paymentId` is the recorded core
   * Payment for pull methods, null for renewal invoices (the checkout records those).
   */
  onCharged?(sub: OnchainSubscription, charge: OnchainCharge, period: PeriodBounds, paymentId: string | null): Promise<void>;
}

export type AccessDeliveryReason = "first_charge" | "reactivated";

export interface AccessDelivery {
  subscription: OnchainSubscription;
  charge: OnchainCharge;
  reason: AccessDeliveryReason;
  /** Stable reference for the run (the charge's core Payment id). */
  paymentId: string;
}

/** Why a collected charge should (re)deliver access, or null for a plain renewal. */
export function deliveryReasonFor(previous: Subscription | undefined, charge: OnchainCharge): AccessDeliveryReason | null {
  if (previous?.status === "expired") return "reactivated";
  if (previous === undefined || charge.periodIndex === 0) return "first_charge";
  return null;
}

export interface AccessHookOptions {
  now?: () => Date;
  onError?: (message: string, meta: Record<string, unknown>) => void;
}

/** Deterministic core Payment id for an onchain charge (refunds look it up). */
export function paymentIdForCharge(chargeId: string): string {
  return `pay_${chargeId}`;
}

/** The onchain charge id behind a payment created by {@link paymentIdForCharge}. */
export function chargeIdForPayment(paymentId: string): string | undefined {
  return paymentId.startsWith("pay_och_") ? paymentId.slice("pay_".length) : undefined;
}

export function createAccessHooks(sinks: AccessSinks, options: AccessHookOptions = {}): ChargeEngineHooks {
  const now = options.now ?? (() => new Date());

  /** Patch the linked core subscription; returns the record as it was before. */
  async function upsertCoreSubscription(
    sub: OnchainSubscription,
    patch: (existing: Subscription | undefined) => Subscription | undefined,
  ): Promise<Subscription | undefined> {
    if (!sub.subscriptionId) return undefined;
    const existing = await sinks.getSubscription(sub.subscriptionId);
    const next = patch(existing);
    if (next) await sinks.saveSubscription(next);
    return existing;
  }

  async function setEntitlements(sub: OnchainSubscription, update: (e: Entitlement) => Entitlement | undefined): Promise<void> {
    for (const entitlement of await sinks.entitlementsFor(sub.customerId, sub.productId)) {
      const next = update(entitlement);
      if (next) await sinks.saveEntitlement(next);
    }
  }

  return {
    async onCollected(sub: OnchainSubscription, charge: OnchainCharge, period: PeriodBounds): Promise<void> {
      const stamp = now().toISOString();
      const previous = await upsertCoreSubscription(sub, (existing) => {
        const base: Subscription = existing ?? {
          id: sub.subscriptionId as string,
          organizationId: sub.organizationId,
          customerId: sub.customerId,
          productId: sub.productId,
          priceId: sub.priceId,
          status: "active",
          currentPeriodStart: period.start.toISOString(),
          currentPeriodEnd: period.end.toISOString(),
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          createdAt: stamp,
        };
        const { graceEndsAt: _grace, ...rest } = base;
        return {
          ...rest,
          status: "active",
          currentPeriodStart: period.start.toISOString(),
          currentPeriodEnd: period.end.toISOString(),
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        };
      });
      if (sub.method !== "renewal_invoice" && sub.checkoutSessionId) {
        await sinks.savePayment({
          id: paymentIdForCharge(charge.id),
          organizationId: sub.organizationId,
          checkoutSessionId: sub.checkoutSessionId,
          customerId: sub.customerId,
          amount: money(fromBaseUnits(BigInt(charge.amount))),
          network: sub.network,
          ...(charge.txHash ? { txHash: charge.txHash } : {}),
          confirmations: 1,
          status: "confirmed",
          createdAt: charge.createdAt,
          confirmedAt: stamp,
        });
      }
      await setEntitlements(sub, (e) =>
        e.status === "revoked" ? undefined : { ...e, status: "active", expiresAt: period.end.toISOString(), updatedAt: stamp },
      );
      if (sinks.onCharged) {
        const recorded = sub.method !== "renewal_invoice" && sub.checkoutSessionId ? paymentIdForCharge(charge.id) : null;
        try {
          await sinks.onCharged(sub, charge, period, recorded);
        } catch (error) {
          options.onError?.("onchain subscription charge notification failed", {
            onchainSubscriptionId: sub.id,
            chargeId: charge.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const reason = sub.subscriptionId ? deliveryReasonFor(previous, charge) : charge.periodIndex === 0 ? "first_charge" : null;
      if (reason && sinks.queueDelivery) {
        try {
          await sinks.queueDelivery({ subscription: sub, charge, reason, paymentId: paymentIdForCharge(charge.id) });
        } catch (error) {
          options.onError?.("onchain subscription delivery could not be queued", {
            onchainSubscriptionId: sub.id,
            chargeId: charge.id,
            reason,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },

    async onPastDue(sub: OnchainSubscription): Promise<void> {
      await upsertCoreSubscription(sub, (existing) => (existing && existing.status !== "canceled" ? { ...existing, status: "past_due" } : undefined));
    },

    async onSuspended(sub: OnchainSubscription): Promise<void> {
      const stamp = now().toISOString();
      await upsertCoreSubscription(sub, (existing) => (existing && existing.status !== "canceled" ? { ...existing, status: "expired" } : undefined));
      await setEntitlements(sub, (e) => (e.status === "active" ? { ...e, status: "expired", expiresAt: stamp, updatedAt: stamp } : undefined));
      options.onError?.("onchain subscription suspended after dunning", { onchainSubscriptionId: sub.id, reason: sub.lastChargeError });
    },
  };
}
