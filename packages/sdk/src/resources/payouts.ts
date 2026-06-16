/**
 * Payouts resource client — merchant settlement.
 *
 * Maps to `/v1/payouts`.
 */
import type { Money } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";

/** A payout of merchant balance to an external wallet. */
export interface Payout {
  id: string;
  organizationId: string;
  walletAddress: string;
  amount: Money;
  network: "arc" | "base" | "ethereum";
  status: "pending" | "paid" | "failed";
  txHash?: string;
}

/** Input for {@link PayoutsResource.create}. */
export interface CreatePayoutInput {
  organizationId: string;
  walletAddress: string;
  amount: string;
  network?: "arc" | "base" | "ethereum";
}

/** Client for payout endpoints. */
export class PayoutsResource {
  constructor(private readonly http: HttpClient) {}

  /** List payouts (optionally for one organization). */
  list(organizationId?: string, options?: RequestOptions): Promise<Payout[]> {
    const qs = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : "";
    return this.http.get<Payout[]>(`/v1/payouts${qs}`, options);
  }

  /** Create a payout (must be within available balance). */
  create(input: CreatePayoutInput, options?: RequestOptions): Promise<Payout> {
    return this.http.post<Payout>("/v1/payouts", input, options);
  }

  /** Mark a payout paid with an on-chain tx hash. */
  markPaid(id: string, txHash: string, options?: RequestOptions): Promise<Payout> {
    return this.http.post<Payout>(`/v1/payouts/${encodeURIComponent(id)}/paid`, { txHash }, options);
  }

  /** Mark a payout failed. */
  markFailed(id: string, reason?: string, options?: RequestOptions): Promise<Payout> {
    return this.http.post<Payout>(`/v1/payouts/${encodeURIComponent(id)}/fail`, reason ? { reason } : {}, options);
  }
}
