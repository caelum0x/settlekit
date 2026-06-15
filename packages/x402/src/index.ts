/**
 * @settlekit/x402 — framework-agnostic "HTTP 402 pay-per-call" middleware built
 * on the web Fetch API (Request / Response).
 *
 * Public API:
 *  - buildPaymentRequiredResponse / buildPaymentRequirements — advertise a 402 challenge.
 *  - parsePaymentHeader / encodePaymentHeader / parsePaymentProof — handle the X-Payment header.
 *  - withSettleKitPayment — gate a Fetch handler behind a verified payment.
 *  - Types describing the verifier and metering contracts the host implements.
 */

export {
  buildPaymentRequiredResponse,
  buildPaymentRequirements,
} from "./payment-required.js";

export {
  encodePaymentHeader,
  parsePaymentHeader,
  parsePaymentProof,
} from "./payment-header.js";

export { withSettleKitPayment } from "./middleware.js";

export {
  ACCEPT_PAYMENT_HEADER,
  HTTP_PAYMENT_REQUIRED,
  PAYMENT_HEADER,
  PAYMENT_REQUIRED_HEADER,
  X402_SCHEME,
} from "./types.js";

export type {
  BuildPaymentRequiredOptions,
  FetchHandler,
  PaymentProof,
  PaymentRequirements,
  PaymentVerifier,
  SettleAndMeter,
  SettleAndMeterContext,
  SettleKitPaymentConfig,
  VerifyResult,
  X402Network,
  X402Scheme,
} from "./types.js";
