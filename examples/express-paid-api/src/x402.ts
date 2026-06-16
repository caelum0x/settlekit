/**
 * Local re-export of the `@settlekit/x402` public API.
 *
 * The `examples/` directory is NOT part of the pnpm workspace (the workspace
 * globs only cover `packages/*` and `apps/*`), so a `workspace:*` dependency
 * would not resolve here. To keep this example runnable with zero extra install
 * steps, we import the package by a relative path to its compiled output.
 *
 * Prerequisite: build the package first from the monorepo root:
 *
 *     pnpm --filter @settlekit/x402 build
 *
 * NodeNext resolution picks up the sibling `index.d.ts` for types and
 * `index.js` for runtime, so both `tsc` and `tsx`/`node` work unchanged.
 *
 * If you instead install `@settlekit/x402` as a real dependency (e.g. inside
 * the monorepo with the example added to the workspace, or after publishing),
 * change the import below to `"@settlekit/x402"` — the rest of this example is
 * unaffected because everything imports from this module.
 */
export {
  buildPaymentRequiredResponse,
  buildPaymentRequirements,
  encodePaymentHeader,
  parsePaymentHeader,
  parsePaymentProof,
  withSettleKitPayment,
  X402_SCHEME,
  HTTP_PAYMENT_REQUIRED,
  PAYMENT_HEADER,
  PAYMENT_REQUIRED_HEADER,
  ACCEPT_PAYMENT_HEADER,
} from "../../../packages/x402/dist/index.js";

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
} from "../../../packages/x402/dist/index.js";
