/**
 * The per-period charge engine shared by the worker job and the API.
 *
 * For every billable onchain subscription it works out the one period that is
 * due, claims (subscription, period) atomically in the store — so concurrent
 * workers / overlapping ticks can never pull twice — and hands the claim to
 * the method's {@link ChargeProvider}. Outcomes:
 *   - collected       -> period marked paid, dunning recovered, onCollected
 *   - invoice sent    -> charge awaits payment; polled on later ticks
 *   - declined        -> charge failed, dunning attempt recorded; the
 *                        subscription goes past_due, or suspended (entitlements
 *                        revoked via onSuspended) once dunning is exhausted
 *   - indeterminate   -> charge left pending; resumed after its lease expires
 *   - deferred        -> claim released, retried next tick, no dunning
 */
import { generateId } from "@settlekit/common";
import { DEFAULT_DUNNING_SCHEDULE, type DunningSchedule, type DunningService, type DunningState } from "@settlekit/dunning";
import { duePeriod, periodBounds, type PeriodBounds } from "./period.js";
import {
  ChargeDeclinedError,
  DeferChargeError,
  IndeterminateChargeError,
  errorMessage,
  type ChargeProvider,
} from "./provider.js";
import type { OnchainBillingStore } from "./store.js";
import type { BillingMethod, OnchainCharge, OnchainSubscription } from "./types.js";

export interface ChargeEngineHooks {
  /** A period was paid: extend the linked subscription/entitlements through `period.end`. */
  onCollected?(subscription: OnchainSubscription, charge: OnchainCharge, period: PeriodBounds): Promise<void>;
  /** A charge failed and a dunning retry is scheduled. */
  onPastDue?(subscription: OnchainSubscription, charge: OnchainCharge, dunning: DunningState): Promise<void>;
  /** Dunning exhausted: suspend entitlements. */
  onSuspended?(subscription: OnchainSubscription, charge: OnchainCharge): Promise<void>;
  /** A renewal invoice was issued for a period. */
  onInvoiced?(subscription: OnchainSubscription, charge: OnchainCharge): Promise<void>;
}

export interface EngineLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface ChargeEngineConfig {
  store: OnchainBillingStore;
  providers: Partial<Record<BillingMethod, ChargeProvider>>;
  dunning: DunningService;
  dunningSchedule?: DunningSchedule;
  /** How long a claimed charge is owned before another worker may resume it. */
  leaseMs?: number;
  hooks?: ChargeEngineHooks;
  logger?: EngineLogger;
  now?: () => Date;
  newId?: () => string;
}

export type ChargeOutcome =
  | "not_due"
  | "succeeded"
  | "already_paid"
  | "awaiting_payment"
  | "failed"
  | "suspended"
  | "in_flight"
  | "indeterminate"
  | "deferred"
  | "waiting_for_retry"
  | "canceled"
  | "provider_unavailable";

export interface ChargeRunSummary {
  processed: number;
  succeeded: number;
  failed: number;
  outcomes: Record<string, ChargeOutcome>;
}

export const DEFAULT_CHARGE_LEASE_MS = 10 * 60_000;

const noopLogger: EngineLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

export class SubscriptionChargeEngine {
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly logger: EngineLogger;

  constructor(private readonly config: ChargeEngineConfig) {
    this.now = config.now ?? (() => new Date());
    this.newId = config.newId ?? (() => `och_${generateId("payment").replace(/^[a-z]+_/, "")}`);
    this.logger = config.logger ?? noopLogger;
  }

  /** Charge every billable subscription whose current period is unpaid. */
  async runDue(): Promise<ChargeRunSummary> {
    const summary: ChargeRunSummary = { processed: 0, succeeded: 0, failed: 0, outcomes: {} };
    for (const subscription of await this.config.store.listBillable()) {
      let outcome: ChargeOutcome;
      try {
        outcome = await this.chargeSubscription(subscription.id);
      } catch (error) {
        this.logger.error("onchain charge crashed", { onchainSubscriptionId: subscription.id, error: errorMessage(error) });
        outcome = "failed";
      }
      summary.outcomes[subscription.id] = outcome;
      if (outcome === "not_due" || outcome === "in_flight" || outcome === "waiting_for_retry") continue;
      summary.processed += 1;
      if (outcome === "succeeded" || outcome === "already_paid") summary.succeeded += 1;
      if (outcome === "failed" || outcome === "suspended") summary.failed += 1;
    }
    return summary;
  }

  private dunningKey(subscription: OnchainSubscription): string {
    return subscription.subscriptionId ?? subscription.id;
  }

  /** Charge one subscription's due period (idempotent per period). */
  async chargeSubscription(onchainSubscriptionId: string): Promise<ChargeOutcome> {
    const now = this.now();
    const subscription = await this.config.store.getSubscription(onchainSubscriptionId);
    if (!subscription || subscription.grant === undefined || subscription.anchorAt === undefined) return "not_due";
    if (subscription.status !== "active" && subscription.status !== "past_due") return "not_due";

    const due = duePeriod(new Date(subscription.anchorAt), subscription.periodSeconds, subscription.paidThrough, now);
    if (due === null) return "not_due";
    if (subscription.cancelAtPeriodEnd) {
      await this.patchSubscription(subscription.id, { status: "canceled", canceledAt: now.toISOString() });
      return "canceled";
    }

    const provider = this.config.providers[subscription.method];
    if (!provider) {
      this.logger.warn("no provider configured for billing method", { onchainSubscriptionId, method: subscription.method });
      return "provider_unavailable";
    }

    if (subscription.status === "past_due") {
      const dunning = await this.config.dunning.get(this.dunningKey(subscription));
      if (dunning?.status === "active" && dunning.nextAttemptAt && new Date(dunning.nextAttemptAt).getTime() > now.getTime()) {
        const existing = await this.config.store.getCharge(subscription.id, due);
        if (existing?.status !== "awaiting_payment") return "waiting_for_retry";
      }
    }

    const claim = await this.config.store.claimCharge({
      subscription,
      periodIndex: due,
      now,
      leaseMs: this.config.leaseMs ?? DEFAULT_CHARGE_LEASE_MS,
      newId: this.newId,
    });
    if (claim.kind === "in_flight") return "in_flight";
    if (claim.kind === "already_succeeded") {
      await this.markPaid(subscription, claim.charge);
      return "already_paid";
    }
    if (claim.kind === "awaiting_payment") return this.pollInvoice(subscription, claim.charge, provider);

    if (subscription.method !== "renewal_invoice" && due >= subscription.periodsCovered) {
      return this.decline(subscription, claim.charge, "the signed grant covers no further periods; the buyer must re-authorize");
    }
    return this.collect(subscription, claim.charge, provider);
  }

  private async collect(subscription: OnchainSubscription, claimed: OnchainCharge, provider: ChargeProvider): Promise<ChargeOutcome> {
    let charge = claimed;
    const priorCollected = (await this.config.store.listCharges(subscription.id))
      .filter((c) => c.status === "succeeded" && c.periodIndex !== charge.periodIndex)
      .reduce((sum, c) => sum + BigInt(c.amount), 0n);
    try {
      const outcome = await provider.collect(subscription, {
        now: this.now(),
        charge,
        priorCollected,
        recordStep: async (step, txHash) => {
          charge = await this.config.store.saveCharge({
            ...charge,
            steps: [...charge.steps, { step, txHash, at: this.now().toISOString() }],
            updatedAt: this.now().toISOString(),
          });
        },
      });
      if (outcome.status === "awaiting_payment") {
        charge = await this.config.store.saveCharge({
          ...charge,
          status: "awaiting_payment",
          invoiceRef: outcome.invoiceRef,
          updatedAt: this.now().toISOString(),
        });
        await this.config.hooks?.onInvoiced?.(subscription, charge);
        return "awaiting_payment";
      }
      charge = await this.config.store.saveCharge({
        ...charge,
        status: "succeeded",
        ...(outcome.txHash ? { txHash: outcome.txHash } : {}),
        updatedAt: this.now().toISOString(),
      });
      await this.markPaid(subscription, charge);
      return "succeeded";
    } catch (error) {
      if (error instanceof IndeterminateChargeError) {
        this.logger.warn("onchain charge outcome unknown; will reconcile", { onchainSubscriptionId: subscription.id, error: error.message });
        return "indeterminate";
      }
      if (error instanceof DeferChargeError) {
        await this.config.store.saveCharge({ ...charge, leaseUntil: this.now().toISOString(), updatedAt: this.now().toISOString() });
        return "deferred";
      }
      const reason = error instanceof ChargeDeclinedError ? error.message : `charge error: ${errorMessage(error)}`;
      return this.decline(subscription, charge, reason);
    }
  }

  private async pollInvoice(subscription: OnchainSubscription, charge: OnchainCharge, provider: ChargeProvider): Promise<ChargeOutcome> {
    const status = provider.invoiceStatus ? await provider.invoiceStatus(subscription, charge) : "open";
    if (status === "open") return "awaiting_payment";
    if (status === "paid") {
      const paid = await this.config.store.saveCharge({ ...charge, status: "succeeded", updatedAt: this.now().toISOString() });
      await this.markPaid(subscription, paid);
      return "succeeded";
    }
    return this.decline(subscription, charge, "renewal invoice expired unpaid");
  }

  private async markPaid(subscription: OnchainSubscription, charge: OnchainCharge): Promise<void> {
    const anchor = new Date(subscription.anchorAt ?? charge.createdAt);
    const period = periodBounds(anchor, subscription.periodSeconds, charge.periodIndex);
    const fresh = await this.patchSubscription(subscription.id, {
      paidThrough: Math.max(subscription.paidThrough, charge.periodIndex),
      status: "active",
      lastChargeError: undefined,
    });
    const dunning = await this.config.dunning.get(this.dunningKey(subscription));
    if (dunning?.status === "active") await this.config.dunning.recordAttempt(this.dunningKey(subscription), "succeeded");
    await this.config.hooks?.onCollected?.(fresh ?? subscription, charge, period);
    this.logger.info("onchain charge collected", {
      onchainSubscriptionId: subscription.id,
      periodIndex: charge.periodIndex,
      txHash: charge.txHash,
    });
  }

  private async decline(subscription: OnchainSubscription, charge: OnchainCharge, reason: string): Promise<ChargeOutcome> {
    const failed = await this.config.store.saveCharge({
      ...charge,
      status: "failed",
      failureReason: reason,
      updatedAt: this.now().toISOString(),
    });
    const key = this.dunningKey(subscription);
    let state = await this.config.dunning.get(key);
    if (state?.status !== "active") {
      const started = await this.config.dunning.start(key, this.config.dunningSchedule ?? DEFAULT_DUNNING_SCHEDULE);
      if (!started.ok) throw started.error;
      state = started.value;
    }
    const recorded = await this.config.dunning.recordAttempt(key, "failed", reason);
    if (!recorded.ok) throw recorded.error;
    state = recorded.value;
    this.logger.warn("onchain charge failed", { onchainSubscriptionId: subscription.id, periodIndex: charge.periodIndex, reason });

    if (state.status === "exhausted") {
      const suspended = await this.patchSubscription(subscription.id, { status: "suspended", lastChargeError: reason });
      await this.config.hooks?.onSuspended?.(suspended ?? subscription, failed);
      return "suspended";
    }
    const pastDue = await this.patchSubscription(subscription.id, { status: "past_due", lastChargeError: reason });
    await this.config.hooks?.onPastDue?.(pastDue ?? subscription, failed, state);
    return "failed";
  }

  /** Re-read and patch billing fields only (never clobber concurrent API edits). */
  private async patchSubscription(id: string, patch: Partial<OnchainSubscription>): Promise<OnchainSubscription | undefined> {
    const current = await this.config.store.getSubscription(id);
    if (!current) return undefined;
    const { lastChargeError: _cleared, ...withoutError } = current;
    const { lastChargeError: nextError, ...rest } = patch;
    const base = "lastChargeError" in patch && nextError === undefined ? withoutError : current;
    const merged: OnchainSubscription = {
      ...base,
      ...rest,
      ...(nextError !== undefined ? { lastChargeError: nextError } : {}),
      // A cancel that raced this charge wins.
      ...(current.status === "canceled" ? { status: "canceled" as const } : {}),
      updatedAt: this.now().toISOString(),
    };
    return this.config.store.saveSubscription(merged);
  }
}
