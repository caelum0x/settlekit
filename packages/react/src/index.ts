/**
 * @settlekit/react — React 18 components and hooks for SaaS feature gating and
 * checkout (plan §4). Wrap your app in <SettleKitProvider>, then gate UI with
 * <Paywall feature="..." fallback={<UpgradeButton input={...} />}> and read
 * state with useEntitlement / useCredits / useCheckout.
 */
export {
  SettleKitProvider,
  useSettleKit,
  useApiConnection,
} from "./provider.js";
export type {
  SettleKitContextValue,
  SettleKitProviderProps,
} from "./provider.js";

export { useEntitlement } from "./use-entitlement.js";
export type {
  UseEntitlementOptions,
  UseEntitlementResult,
} from "./use-entitlement.js";

export { useCheckout } from "./use-checkout.js";
export type { UseCheckoutResult } from "./use-checkout.js";

export { useCredits } from "./use-credits.js";
export type { UseCreditsResult } from "./use-credits.js";

export { Paywall } from "./paywall.js";
export type { PaywallProps } from "./paywall.js";

export { UpgradeButton } from "./upgrade-button.js";
export type { UpgradeButtonProps } from "./upgrade-button.js";

export { apiRequest, toSettleKitError } from "./http.js";
export type { ApiConnection, ApiRequest } from "./http.js";

export type {
  ApiEnvelope,
  DataEnvelope,
  ErrorEnvelope,
  VerifyResult,
  CheckoutLineItemInput,
  CheckoutNetwork,
  CreateCheckoutInput,
} from "./types.js";
