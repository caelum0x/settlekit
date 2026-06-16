/**
 * Usage-based billing resource client — metering + prepaid credits.
 *
 * Maps to `/v1/usage` (record / meter / charge / limit / credits).
 */
import type { UsageMeter, CreditBalance, Money } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";

/** Identity of a metered dimension. */
export interface MeterRef {
  organizationId: string;
  customerId: string;
  productId: string;
  metric: string;
}

/** Identity of a prepaid balance. */
export interface BalanceRef {
  organizationId: string;
  customerId: string;
  productId: string;
}

/** Result of a usage-limit check. */
export interface LimitCheck {
  withinLimit: boolean;
  used: number;
  limit: number;
  remaining: number;
}

/** Client for usage-based billing endpoints. */
export class UsageResource {
  constructor(private readonly http: HttpClient) {}

  /** Record `quantity` units of a metric (creates the meter on first use). */
  record(input: MeterRef & { quantity?: number; periodStart?: string }, options?: RequestOptions): Promise<UsageMeter> {
    return this.http.post<UsageMeter>("/v1/usage/record", input, options);
  }

  /** Compute the charge for a meter's usage at a unit price. */
  charge(input: MeterRef & { unitAmount: string; periodStart?: string }, options?: RequestOptions): Promise<Money> {
    return this.http.post<Money>("/v1/usage/charge", input, options);
  }

  /** Evaluate usage against a hard limit. */
  limit(input: MeterRef & { limit: number; periodStart?: string }, options?: RequestOptions): Promise<LimitCheck> {
    return this.http.post<LimitCheck>("/v1/usage/limit", input, options);
  }

  /** Read a prepaid credit balance. */
  credits(ref: BalanceRef, options?: RequestOptions): Promise<CreditBalance | null> {
    return this.http.get<CreditBalance | null>(
      `/v1/usage/credits?organizationId=${encodeURIComponent(ref.organizationId)}&customerId=${encodeURIComponent(ref.customerId)}&productId=${encodeURIComponent(ref.productId)}`,
      options,
    );
  }

  /** Grant prepaid credits. */
  grantCredits(input: BalanceRef & { credits: number }, options?: RequestOptions): Promise<CreditBalance> {
    return this.http.post<CreditBalance>("/v1/usage/credits/grant", input, options);
  }

  /** Consume prepaid credits (meter a paid call). */
  consumeCredits(input: BalanceRef & { credits?: number }, options?: RequestOptions): Promise<CreditBalance> {
    return this.http.post<CreditBalance>("/v1/usage/credits/consume", input, options);
  }
}
