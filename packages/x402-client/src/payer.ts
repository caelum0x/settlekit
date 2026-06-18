/**
 * The client side of x402: fetch a resource, and if it answers `402 Payment
 * Required`, settle the advertised challenge and retry with the proof attached.
 *
 * The transport is a {@link RequestFetcher} so callers can pass global `fetch`
 * for real HTTP, or an in-process `withSettleKitPayment`-wrapped handler for a
 * fully local closed loop.
 */

import {
  type Money,
  type Result,
  err,
  money,
  compareMoney,
  ok,
  SettleKitError,
} from "@settlekit/common";
import {
  HTTP_PAYMENT_REQUIRED,
  PAYMENT_HEADER,
  encodePaymentHeader,
  type PaymentProof,
  type PaymentRequirements,
} from "@settlekit/x402";
import type { PaidFetchResult, RequestFetcher, Settler } from "./types.js";

/** Options for {@link payAndFetch}. */
export interface PayAndFetchOptions {
  /** Transport. Defaults to global `fetch`. */
  fetcher?: RequestFetcher;
  /** Settler that satisfies the x402 challenge. */
  settler: Settler;
  /** Payer address/identifier (echoed as proof.from). */
  from: string;
  /** Optional per-call spend cap. If the advertised price exceeds it, the call
   * fails before any payment is made. */
  maxPriceUsdc?: string;
  /** Extra request init (method, headers, body) applied to both attempts. */
  init?: RequestInit;
}

function defaultFetcher(request: Request): Promise<Response> {
  return fetch(request);
}

function readRequirements(body: unknown): PaymentRequirements | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const accepts = (body as { accepts?: unknown }).accepts;
  if (!Array.isArray(accepts) || accepts.length === 0) {
    return undefined;
  }
  return accepts[0] as PaymentRequirements;
}

/**
 * Fetch `url`, paying the x402 toll if challenged.
 *
 * Returns the served response and, when a payment was made, the proof,
 * requirements, and amount. A non-402 first response is returned unpaid. A 402
 * on the retry (the verifier rejected the proof) surfaces as a `payment_failed`
 * error.
 */
export async function payAndFetch(
  url: string,
  options: PayAndFetchOptions,
): Promise<Result<PaidFetchResult, SettleKitError>> {
  const fetcher = options.fetcher ?? defaultFetcher;

  const first = await fetcher(new Request(url, options.init));
  if (first.status !== HTTP_PAYMENT_REQUIRED) {
    return ok({ response: first, paid: false });
  }

  let body: unknown;
  try {
    body = await first.clone().json();
  } catch {
    return err(paymentError("payment_required", "402 challenge had no JSON body"));
  }

  const requirements = readRequirements(body);
  if (requirements === undefined) {
    return err(paymentError("payment_required", "402 challenge advertised no requirements"));
  }

  const price: Money = money(requirements.amount);
  if (options.maxPriceUsdc !== undefined) {
    if (compareMoney(price, money(options.maxPriceUsdc)) > 0) {
      return err(
        paymentError(
          "payment_required",
          `price ${requirements.amount} USDC exceeds cap ${options.maxPriceUsdc} USDC`,
        ),
      );
    }
  }

  let proof: PaymentProof;
  try {
    proof = await options.settler.settle({ requirements, from: options.from });
  } catch (cause) {
    if (SettleKitError.is(cause)) {
      return err(cause);
    }
    return err(paymentError("payment_failed", messageOf(cause)));
  }

  const headers = new Headers(options.init?.headers);
  headers.set(PAYMENT_HEADER, encodePaymentHeader(proof));
  const retry = await fetcher(new Request(url, { ...options.init, headers }));

  if (retry.status === HTTP_PAYMENT_REQUIRED) {
    return err(paymentError("payment_failed", "payment proof was rejected by the resource"));
  }

  return ok({
    response: retry,
    paid: true,
    proof,
    requirements,
    amount: price,
  });
}

function paymentError(
  code: "payment_required" | "payment_failed",
  message: string,
): SettleKitError {
  return new SettleKitError({ code, message, retryable: code === "payment_failed" });
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "settlement failed";
}
