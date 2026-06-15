import type { CreditBalance, Money, UsageMeter } from "@settlekit/common";
import { notFound, toIso, validationError } from "@settlekit/common";

import { computeUsageCharge } from "./charges.js";
import { consumeCredits, createBalance, grantCredits } from "./credits.js";
import { checkLimit, type LimitCheck } from "./limit.js";
import { createMeter, recordUsage, resetForNewPeriod, type UsagePeriod } from "./meter.js";
import type { MeterStore } from "./store.js";

/** Identity of a metered dimension for a customer + product. */
export interface MeterRef {
  organizationId: string;
  customerId: string;
  productId: string;
  metric: string;
}

/** Identity of a prepaid credit balance for a customer + product. */
export interface BalanceRef {
  organizationId: string;
  customerId: string;
  productId: string;
}

/**
 * Application service orchestrating usage metering and prepaid credits on top
 * of a {@link MeterStore}. All domain mutations go through the immutable
 * pure functions and are persisted back to the store.
 */
export class UsageService {
  constructor(
    private readonly store: MeterStore,
    private readonly period: UsagePeriod = "monthly",
  ) {}

  /**
   * Record usage for a metered dimension within the period containing
   * `periodStart`, creating the meter on first use. Returns the updated meter.
   */
  async record(
    ref: MeterRef,
    qty: number,
    periodStart: Date,
    now: Date = new Date(),
  ): Promise<UsageMeter> {
    void now;
    const periodStartIso = toIso(periodStart);
    const existing = await this.store.findMeter(
      ref.customerId,
      ref.productId,
      ref.metric,
      periodStartIso,
    );

    const meter =
      existing ??
      createMeter({
        organizationId: ref.organizationId,
        customerId: ref.customerId,
        productId: ref.productId,
        metric: ref.metric,
        periodStart,
        period: this.period,
      });

    const updated = recordUsage(meter, ref.metric, qty);
    return this.store.putMeter(updated);
  }

  /** Fetch the current meter for a dimension/period, or null if none exists. */
  async getMeter(ref: MeterRef, periodStart: Date): Promise<UsageMeter | null> {
    return this.store.findMeter(
      ref.customerId,
      ref.productId,
      ref.metric,
      toIso(periodStart),
    );
  }

  /**
   * Compute the charge for a dimension's usage in a period at `unitAmount`.
   * Throws not_found if the meter does not exist.
   */
  async charge(ref: MeterRef, periodStart: Date, unitAmount: Money): Promise<Money> {
    const meter = await this.getMeter(ref, periodStart);
    if (meter === null) {
      throw notFound("No usage meter for the requested period", {
        customerId: ref.customerId,
        productId: ref.productId,
        metric: ref.metric,
      });
    }
    return computeUsageCharge(meter, unitAmount);
  }

  /**
   * Evaluate a dimension's usage against a hard limit. A missing meter is
   * treated as zero usage (fully within any non-negative limit).
   */
  async limit(ref: MeterRef, periodStart: Date, limit: number): Promise<LimitCheck> {
    const meter = await this.getMeter(ref, periodStart);
    const subject: UsageMeter =
      meter ??
      createMeter({
        organizationId: ref.organizationId,
        customerId: ref.customerId,
        productId: ref.productId,
        metric: ref.metric,
        periodStart,
        period: this.period,
      });
    return checkLimit(subject, limit);
  }

  /**
   * Roll the meter for a dimension into a new period, persisting the fresh
   * zeroed meter. Returns the new meter.
   */
  async rollPeriod(ref: MeterRef, newPeriodStart: Date): Promise<UsageMeter> {
    const current = await this.getMeter(ref, newPeriodStart);
    const source =
      current ??
      createMeter({
        organizationId: ref.organizationId,
        customerId: ref.customerId,
        productId: ref.productId,
        metric: ref.metric,
        periodStart: newPeriodStart,
        period: this.period,
      });
    const next = resetForNewPeriod(source, newPeriodStart, this.period);
    return this.store.putMeter(next);
  }

  /** Fetch the prepaid balance for a customer/product, or null. */
  async getBalance(ref: BalanceRef): Promise<CreditBalance | null> {
    return this.store.findBalance(ref.customerId, ref.productId);
  }

  /**
   * Grant `n` credits, creating the balance on first use. Returns the updated
   * balance.
   */
  async grant(ref: BalanceRef, n: number, now: Date = new Date()): Promise<CreditBalance> {
    const existing = await this.store.findBalance(ref.customerId, ref.productId);
    const balance =
      existing ??
      createBalance(
        {
          organizationId: ref.organizationId,
          customerId: ref.customerId,
          productId: ref.productId,
        },
        now,
      );
    const updated = grantCredits(balance, n, now);
    return this.store.putBalance(updated);
  }

  /**
   * Consume `n` credits from an existing balance. Throws not_found when the
   * balance does not exist and insufficient_credits when it cannot cover the
   * request. Returns the updated balance.
   */
  async consume(ref: BalanceRef, n: number, now: Date = new Date()): Promise<CreditBalance> {
    if (!Number.isInteger(n) || n < 0) {
      throw validationError("n must be a non-negative integer", { n });
    }
    const balance = await this.store.findBalance(ref.customerId, ref.productId);
    if (balance === null) {
      throw notFound("No credit balance for customer/product", {
        customerId: ref.customerId,
        productId: ref.productId,
      });
    }
    const updated = consumeCredits(balance, n, now);
    return this.store.putBalance(updated);
  }
}
