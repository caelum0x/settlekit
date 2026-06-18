/**
 * Client-side x402 types: the {@link Settler} contract a paying agent uses to
 * turn an advertised {@link PaymentRequirements} challenge into a
 * {@link PaymentProof}, plus the result of a paid fetch.
 */

import type { Money } from "@settlekit/common";
import type { PaymentProof, PaymentRequirements } from "@settlekit/x402";

/** A request to settle a single x402 challenge. */
export interface SettleRequest {
  /** The requirements advertised on the 402 response. */
  requirements: PaymentRequirements;
  /** The address/identifier the payment is sent from. */
  from: string;
}

/**
 * A Settler executes the on-chain (or simulated) USDC transfer that satisfies an
 * x402 challenge and returns a verifiable proof. Implementations: a local ledger
 * (runnable demos / tests) or Circle programmable wallets (real testnet USDC).
 */
export interface Settler {
  settle(request: SettleRequest): Promise<PaymentProof>;
}

/** A Fetch-shaped transport. Defaults to global `fetch`, but in-process handlers
 * (e.g. a `withSettleKitPayment`-wrapped handler) can be passed directly so the
 * full pay-and-retry loop runs without a network. */
export type RequestFetcher = (request: Request) => Promise<Response>;

/** Outcome of {@link payAndFetch}. */
export interface PaidFetchResult {
  /** The final response (the paid 200 when `paid` is true). */
  response: Response;
  /** Whether a payment was made (false when the resource was free / non-402). */
  paid: boolean;
  /** The proof submitted on the paid retry. */
  proof?: PaymentProof;
  /** The requirements that were satisfied. */
  requirements?: PaymentRequirements;
  /** The amount paid, as Money. */
  amount?: Money;
}
