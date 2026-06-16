/**
 * Shared SettleKit configuration for the AI Export Pro demo.
 *
 * All values are read from `NEXT_PUBLIC_*` env vars so they are available in the
 * browser (the `@settlekit/react` SDK talks to the API directly over HTTP from
 * the client). Sensible local-dev defaults are provided so the example runs out
 * of the box against a SettleKit API started with `API_BOOTSTRAP_KEY=sk_dev`.
 */

/** Base origin of the SettleKit API. The SDK appends `/v1` itself. */
export const SETTLEKIT_API_URL =
  process.env.NEXT_PUBLIC_SETTLEKIT_API_URL ?? "http://localhost:8787";

/**
 * Publishable / bootstrap API key sent as a Bearer token by the SDK. For local
 * dev, start the API with `API_BOOTSTRAP_KEY=sk_dev` and keep this default.
 */
export const SETTLEKIT_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SETTLEKIT_PUBLISHABLE_KEY ?? "sk_dev";

/** The premium feature flag this demo gates the AI export behind. */
export const AI_EXPORT_FEATURE = "ai_export";

/**
 * Identifiers describing the "Pro" plan the upgrade flow checks out into. These
 * map onto the merchant/organization/product you created in the SettleKit API
 * (see README). Override them via env to point at your own catalog.
 */
export const DEMO_ORGANIZATION_ID =
  process.env.NEXT_PUBLIC_SETTLEKIT_ORG_ID ?? "org_demo";
export const DEMO_MERCHANT_ID =
  process.env.NEXT_PUBLIC_SETTLEKIT_MERCHANT_ID ?? "merchant_demo";
export const DEMO_PRO_PRICE_ID =
  process.env.NEXT_PUBLIC_SETTLEKIT_PRO_PRICE_ID ?? "price_pro_monthly";
export const DEMO_PAY_TO_ADDRESS =
  process.env.NEXT_PUBLIC_SETTLEKIT_PAY_TO_ADDRESS ??
  "0x000000000000000000000000000000000000dEaD";

/** Network the demo checkout settles on (one of "arc" | "base" | "ethereum"). */
export const DEMO_NETWORK = "base" as const;
