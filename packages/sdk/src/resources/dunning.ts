/**
 * Dunning resource client.
 *
 * Maps to `/v1/dunning`. Dunning recovers failed subscription payments: start a
 * campaign for a subscription, record attempt outcomes, and recover (or let it
 * exhaust its schedule).
 */
import type { HttpClient, RequestOptions } from "../http-client.js";

/** Lifecycle of a dunning campaign. */
export type DunningStatus = "active" | "recovered" | "exhausted";

/** A recorded dunning attempt. */
export interface DunningAttemptRecord {
  attempt: number;
  outcome: "recovered" | "failed";
  failureReason?: string;
  at: string;
}

/** The dunning state for a subscription, as returned by the API. */
export interface DunningState {
  subscriptionId: string;
  attempt: number;
  status: DunningStatus;
  nextAttemptAt?: string;
  history: DunningAttemptRecord[];
  startedAt: string;
  updatedAt: string;
}

/** Outcome of a dunning attempt. */
export type DunningOutcome = "recovered" | "failed";

/** Client for dunning endpoints. */
export class DunningResource {
  constructor(private readonly http: HttpClient) {}

  /** List active dunning campaigns (or only those due when `dueOnly`). */
  list(dueOnly = false, options?: RequestOptions): Promise<DunningState[]> {
    const qs = dueOnly ? "?due=true" : "";
    return this.http.get<DunningState[]>(`/v1/dunning${qs}`, options);
  }

  /** Start a dunning campaign for a subscription with a failed payment. */
  start(subscriptionId: string, options?: RequestOptions): Promise<DunningState> {
    return this.http.post<DunningState>("/v1/dunning", { subscriptionId }, options);
  }

  /**
   * Record an attempt outcome. `recovered` closes the campaign; `failed`
   * advances it (or exhausts the schedule), optionally with a failure reason.
   */
  attempt(
    subscriptionId: string,
    outcome: DunningOutcome,
    failureReason?: string,
    options?: RequestOptions,
  ): Promise<DunningState> {
    return this.http.post<DunningState>(
      `/v1/dunning/${encodeURIComponent(subscriptionId)}/attempt`,
      failureReason ? { outcome, failureReason } : { outcome },
      options,
    );
  }

  /** Mark a subscription's dunning campaign as recovered. */
  recover(subscriptionId: string, options?: RequestOptions): Promise<DunningState> {
    return this.http.post<DunningState>(
      `/v1/dunning/${encodeURIComponent(subscriptionId)}/recover`,
      undefined,
      options,
    );
  }
}
