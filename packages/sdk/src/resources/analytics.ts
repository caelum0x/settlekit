/**
 * Analytics resource client — the merchant dashboard summary.
 *
 * Maps to `/v1/analytics`.
 */
import type { Money } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";

/** Live-computed merchant summary returned by `/v1/analytics/summary`. */
export interface AnalyticsSummary {
  revenue: Money;
  customers: number;
  activeAccess: number;
  expiringSubscriptions: number;
  failedDeliveries: number;
  mrr: Money;
  revenueSeries: { date: string; amount: number }[];
}

/** Client for analytics endpoints. */
export class AnalyticsResource {
  constructor(private readonly http: HttpClient) {}

  /** Fetch the dashboard summary for an organization (defaults to the platform org). */
  summary(organizationId?: string, options?: RequestOptions): Promise<AnalyticsSummary> {
    const qs = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : "";
    return this.http.get<AnalyticsSummary>(`/v1/analytics/summary${qs}`, options);
  }
}
