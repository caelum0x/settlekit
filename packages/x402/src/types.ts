/**
 * Public types for the x402 "HTTP 402 pay-per-call" protocol middleware.
 *
 * The x402 scheme advertises payment requirements on a 402 response and accepts
 * a proof-of-payment header on the retry. This package is framework-agnostic and
 * operates purely on the web Fetch API (Request / Response).
 */

import type { Currency } from "@settlekit/common";

/**
 * The blockchain network a payment must settle on. We keep this aligned with
 * the wider SettleKit `PaymentNetwork` union but x402 only meaningfully supports
 * USDC-capable networks.
 */
export type X402Network = "arc" | "base" | "ethereum";

/** The payment scheme advertised in the requirements document. */
export const X402_SCHEME = "x402" as const;
export type X402Scheme = typeof X402_SCHEME;

/** HTTP status used to challenge an unpaid request. */
export const HTTP_PAYMENT_REQUIRED = 402 as const;

/** Header carrying the proof-of-payment on a retried request (base64 JSON). */
export const PAYMENT_HEADER = "X-Payment" as const;

/** Header carrying the advertised requirements on a 402 response (JSON). */
export const PAYMENT_REQUIRED_HEADER = "X-Payment-Required" as const;

/** Companion header name, kept for client interop. */
export const ACCEPT_PAYMENT_HEADER = "Accept-Payment" as const;

/**
 * Machine-readable payment requirements advertised on a 402 response. This is
 * serialized as JSON into both the response body and the `X-Payment-Required`
 * header so clients can discover how to pay without parsing prose.
 */
export interface PaymentRequirements {
  scheme: X402Scheme;
  /** Decimal major-unit amount owed, e.g. "0.005". */
  amount: string;
  /** Asset symbol. x402 in SettleKit settles exclusively in USDC. */
  asset: Currency;
  network: X402Network;
  /** Address the payment must be sent to. */
  payTo: string;
  /** Product the call is gated behind, for usage attribution. */
  productId: string;
  /** Canonical URL / identifier of the protected resource. */
  resource: string;
  /** One-time value the client must echo back to bind the payment to this challenge. */
  nonce: string;
}

/** Options for {@link buildPaymentRequiredResponse}. */
export interface BuildPaymentRequiredOptions {
  /** Decimal major-unit price, e.g. "0.005". */
  price: string;
  /** Settlement currency. Only "USDC" is supported. */
  currency: Currency;
  network: X402Network;
  /** Destination address for the payment. */
  payTo: string;
  productId: string;
  /** Canonical identifier of the protected resource (e.g. the request URL). */
  resource: string;
  /**
   * Optional explicit nonce. When omitted a cryptographically random nonce is
   * generated. Supplying one lets the host persist + later verify it.
   */
  nonce?: string;
}

/**
 * Proof-of-payment parsed from the inbound `X-Payment` header (base64 JSON).
 */
export interface PaymentProof {
  /** On-chain transaction hash of the settling transfer. */
  txHash: string;
  /** Address that sent the funds. */
  from: string;
  /** Decimal major-unit amount that was paid. */
  amount: string;
  network: X402Network;
  /** Nonce echoed back from the 402 challenge. */
  nonce: string;
}

/**
 * Outcome of verifying a {@link PaymentProof}. Verification itself is supplied by
 * the host (it will use @settlekit/arc / @settlekit/circle in the app), so this
 * package only defines the contract.
 */
export interface VerifyResult {
  ok: boolean;
  /** Human-readable reason when `ok` is false. */
  reason?: string;
}

/**
 * Verifier contract. The host implements this against a real chain indexer /
 * settlement provider. It receives the parsed proof and the requirements that
 * were challenged so it can confirm the on-chain transfer matches.
 */
export type PaymentVerifier = (
  proof: PaymentProof,
  requirements: PaymentRequirements,
) => Promise<VerifyResult>;

/**
 * Metering context passed to the {@link SettleAndMeter} hook after a call has
 * been paid for and successfully served.
 */
export interface SettleAndMeterContext {
  proof: PaymentProof;
  requirements: PaymentRequirements;
  /** The Request that was served. */
  request: Request;
  /** The Response returned by the protected handler. */
  response: Response;
}

/**
 * Usage-recording hook invoked after a successful paid call. Implementations
 * record a usage event (e.g. via @settlekit/metering). Errors thrown here are
 * swallowed so metering never breaks the served response.
 */
export type SettleAndMeter = (context: SettleAndMeterContext) => void | Promise<void>;

/** A web Fetch handler: maps a Request to a Response. */
export type FetchHandler = (request: Request) => Response | Promise<Response>;

/** Configuration for {@link withSettleKitPayment}. */
export interface SettleKitPaymentConfig {
  price: string;
  currency: Currency;
  productId: string;
  network: X402Network;
  payTo: string;
  /** Host-supplied verifier that confirms a proof on-chain. */
  verify: PaymentVerifier;
  /**
   * Optional override for the resource identifier. Defaults to the request URL.
   */
  resource?: string;
  /**
   * Optional stable nonce for the challenge. When set, the same nonce is
   * advertised in the 402 challenge AND passed to {@link PaymentVerifier} on the
   * paid request, so a stateless verifier can confirm the proof echoed the
   * challenge it was issued. When omitted a fresh random nonce is generated per
   * challenge (suitable when the verifier tracks issued nonces out-of-band).
   */
  nonce?: string;
  /** Optional usage-recording hook run after a successful paid call. */
  settleAndMeter?: SettleAndMeter;
}
