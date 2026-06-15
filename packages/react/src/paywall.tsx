"use client";

/**
 * <Paywall> — gates its children behind a SaaS feature entitlement (plan §4):
 *
 *   <Paywall feature="ai_export" fallback={<UpgradeButton/>}>
 *     <AiExport />
 *   </Paywall>
 *
 * Renders `loading` while resolving, `fallback` when access is denied, and the
 * children once the entitlement is confirmed.
 */
import { Fragment, createElement } from "react";
import type { ReactNode } from "react";
import { useEntitlement } from "./use-entitlement.js";
import type { UseEntitlementOptions } from "./use-entitlement.js";

/** Props for {@link Paywall}. */
export interface PaywallProps extends UseEntitlementOptions {
  /** The SaaS feature flag to verify. */
  feature: string;
  /** Rendered when the customer is not entitled to the feature. */
  fallback?: ReactNode;
  /** Rendered while the entitlement is being verified. Defaults to nothing. */
  loading?: ReactNode;
  /** Gated content shown only when access is allowed. */
  children: ReactNode;
}

/** Conditionally render children based on a feature entitlement. */
export function Paywall(props: PaywallProps): ReactNode {
  const { feature, fallback = null, loading = null, children, ...options } = props;
  const { allowed, loading: resolving } = useEntitlement(feature, options);

  if (resolving) return createElement(Fragment, null, loading);
  if (!allowed) return createElement(Fragment, null, fallback);
  return createElement(Fragment, null, children);
}
