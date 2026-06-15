/**
 * The `withSettleKitPayment` middleware: wraps a Fetch handler so that callers
 * must present a verified x402 payment before the handler runs.
 *
 * Flow per request:
 *   1. Read the `X-Payment` header. If absent -> return a 402 challenge.
 *   2. If present but malformed -> return a 402 challenge with the reason.
 *   3. Run the host-supplied `verify(proof, requirements)`.
 *        - failure -> 402 with the verifier's reason.
 *        - success -> run the protected `handler`, then fire `settleAndMeter`.
 */

import { isErr } from "@settlekit/common";
import { parsePaymentHeader } from "./payment-header.js";
import { buildPaymentRequiredResponse, buildPaymentRequirements } from "./payment-required.js";
import type {
  FetchHandler,
  PaymentProof,
  PaymentRequirements,
  SettleAndMeter,
  SettleAndMeterContext,
  SettleKitPaymentConfig,
} from "./types.js";

function resourceFor(config: SettleKitPaymentConfig, request: Request): string {
  return config.resource ?? request.url;
}

function requirementsFor(
  config: SettleKitPaymentConfig,
  resource: string,
): PaymentRequirements {
  return buildPaymentRequirements({
    price: config.price,
    currency: config.currency,
    network: config.network,
    payTo: config.payTo,
    productId: config.productId,
    resource,
    ...(config.nonce !== undefined ? { nonce: config.nonce } : {}),
  });
}

function challenge(
  config: SettleKitPaymentConfig,
  resource: string,
  reason?: string,
): Response {
  return buildPaymentRequiredResponse(
    {
      price: config.price,
      currency: config.currency,
      network: config.network,
      payTo: config.payTo,
      productId: config.productId,
      resource,
      ...(config.nonce !== undefined ? { nonce: config.nonce } : {}),
    },
    reason !== undefined ? { reason } : undefined,
  );
}

/**
 * Fire the optional metering hook without ever letting it break the response.
 * Metering is best-effort: failures are reported to stderr but swallowed.
 */
async function runSettleAndMeter(
  settleAndMeter: SettleAndMeter,
  context: SettleAndMeterContext,
): Promise<void> {
  try {
    await settleAndMeter(context);
  } catch (cause) {
    // Never let usage recording corrupt a successfully-served paid response.
    console.error("[x402] settleAndMeter hook failed", cause);
  }
}

/**
 * Wrap a Fetch handler so it is gated behind a verified x402 payment.
 *
 * @example
 * const paid = withSettleKitPayment({
 *   price: "0.005", currency: "USDC", network: "arc",
 *   payTo: "0xabc...", productId: "prod_123",
 *   verify: async (proof, req) => circle.verifyTransfer(proof, req),
 * })(async (req) => Response.json({ data: "secret" }));
 */
export function withSettleKitPayment(
  config: SettleKitPaymentConfig,
): (handler: FetchHandler) => (request: Request) => Promise<Response> {
  if (typeof config.verify !== "function") {
    throw new TypeError("withSettleKitPayment: config.verify must be a function");
  }

  return function wrap(handler: FetchHandler): (request: Request) => Promise<Response> {
    return async function paidHandler(request: Request): Promise<Response> {
      const resource = resourceFor(config, request);

      const parsed = parsePaymentHeader(request);
      if (isErr(parsed)) {
        return challenge(config, resource, parsed.error);
      }

      const proof: PaymentProof | null = parsed.value;
      if (proof === null) {
        // No payment presented yet -> advertise requirements.
        return challenge(config, resource);
      }

      const requirements = requirementsFor(config, resource);

      const verification = await config.verify(proof, requirements);
      if (!verification.ok) {
        return challenge(config, resource, verification.reason ?? "payment verification failed");
      }

      const response = await handler(request);

      if (config.settleAndMeter !== undefined) {
        await runSettleAndMeter(config.settleAndMeter, {
          proof,
          requirements,
          request,
          response,
        });
      }

      return response;
    };
  };
}
