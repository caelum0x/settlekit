/**
 * Spec-compliant x402 v2 helpers built on the x402-foundation packages
 * (`@x402/core` 2.27, Apache-2.0). The legacy Arc tx-hash scheme in the
 * parent module is unchanged and keeps serving `/v1/paid/*`.
 */
export * from "./facilitator-routing.js";
export {
  PAYMENT_REQUIRED_HEADER_V2,
  PAYMENT_RESPONSE_HEADER_V2,
  PAYMENT_SIGNATURE_HEADER_V2,
} from "./headers.js";
