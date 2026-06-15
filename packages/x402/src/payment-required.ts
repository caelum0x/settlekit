/**
 * Building 402 "Payment Required" responses that advertise x402 payment
 * requirements in a machine-readable form.
 */

import { generateSecret } from "@settlekit/common";
import {
  ACCEPT_PAYMENT_HEADER,
  HTTP_PAYMENT_REQUIRED,
  PAYMENT_REQUIRED_HEADER,
  X402_SCHEME,
  type BuildPaymentRequiredOptions,
  type PaymentRequirements,
} from "./types.js";

const REQUIRED_FIELDS: ReadonlyArray<keyof BuildPaymentRequiredOptions> = [
  "price",
  "currency",
  "network",
  "payTo",
  "productId",
  "resource",
];

function assertOptions(options: BuildPaymentRequiredOptions): void {
  for (const field of REQUIRED_FIELDS) {
    const value = options[field];
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError(`buildPaymentRequiredResponse: "${field}" is required`);
    }
  }
  if (options.currency !== "USDC") {
    throw new TypeError(
      `buildPaymentRequiredResponse: only "USDC" is supported, got "${options.currency}"`,
    );
  }
}

/**
 * Construct the {@link PaymentRequirements} document for a challenge. Generates
 * a random nonce when one is not supplied.
 */
export function buildPaymentRequirements(
  options: BuildPaymentRequiredOptions,
): PaymentRequirements {
  assertOptions(options);
  return {
    scheme: X402_SCHEME,
    amount: options.price,
    asset: options.currency,
    network: options.network,
    payTo: options.payTo,
    productId: options.productId,
    resource: options.resource,
    nonce: options.nonce ?? generateSecret(16),
  };
}

/**
 * Build a `402 Payment Required` web `Response` whose body and headers describe
 * how to pay for the protected resource via the x402 scheme.
 *
 * The same requirements JSON is placed in:
 *  - the response body (so browsers / fetch clients can read it),
 *  - the `X-Payment-Required` header,
 *  - the `Accept-Payment` header (client interop alias).
 */
export function buildPaymentRequiredResponse(
  options: BuildPaymentRequiredOptions,
  extra?: { reason?: string },
): Response {
  const requirements = buildPaymentRequirements(options);
  const requirementsJson = JSON.stringify(requirements);

  const body: { error: "payment_required"; accepts: PaymentRequirements[]; reason?: string } = {
    error: "payment_required",
    accepts: [requirements],
  };
  if (extra?.reason !== undefined) {
    body.reason = extra.reason;
  }

  return new Response(JSON.stringify(body), {
    status: HTTP_PAYMENT_REQUIRED,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      [PAYMENT_REQUIRED_HEADER]: requirementsJson,
      [ACCEPT_PAYMENT_HEADER]: requirementsJson,
    },
  });
}
