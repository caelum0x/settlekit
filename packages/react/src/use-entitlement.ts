"use client";

/**
 * useEntitlement — verifies whether the current customer is allowed to use a
 * SaaS feature (plan §4). Calls the API `/entitlements/verify` endpoint and
 * exposes loading/error state plus a manual `refetch`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { SettleKitError } from "@settlekit/common";
import { apiRequest, toSettleKitError } from "./http.js";
import { useApiConnection, useSettleKit } from "./provider.js";
import type { VerifyResult } from "./types.js";

/** Options for {@link useEntitlement}. */
export interface UseEntitlementOptions {
  /** Override the customer id from context (e.g. checking another tenant). */
  customerId?: string;
  /** Scope verification to a specific product. */
  productId?: string;
  /** Require at least this many credits to be considered allowed. */
  requiredCredits?: number;
}

/** Return shape of {@link useEntitlement}. */
export interface UseEntitlementResult {
  /** Whether access is granted. `false` until resolved. */
  allowed: boolean;
  /** Machine-readable reason when not allowed. */
  reason?: string;
  /** True while a verification request is in flight. */
  loading: boolean;
  /** The error from the most recent failed request, if any. */
  error: SettleKitError | null;
  /** Re-run verification on demand. */
  refetch: () => void;
}

/** Verify a SaaS feature entitlement for the current customer. */
export function useEntitlement(
  feature: string,
  options: UseEntitlementOptions = {},
): UseEntitlementResult {
  const connection = useApiConnection();
  const { customerId: contextCustomerId } = useSettleKit();
  const customerId = options.customerId ?? contextCustomerId;
  const { productId, requiredCredits } = options;

  const [allowed, setAllowed] = useState(false);
  const [reason, setReason] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<SettleKitError | null>(null);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  // Keep the latest connection without retriggering the request effect on each
  // render-stable object identity change.
  const connectionRef = useRef(connection);
  connectionRef.current = connection;

  useEffect(() => {
    if (!customerId) {
      setAllowed(false);
      setReason("customer_unidentified");
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError(null);

    apiRequest<VerifyResult>(connectionRef.current, {
      path: "/entitlements/verify",
      method: "POST",
      signal: controller.signal,
      body: {
        customerId,
        feature,
        ...(productId !== undefined ? { productId } : {}),
        ...(requiredCredits !== undefined ? { requiredCredits } : {}),
      },
    })
      .then((result) => {
        if (!active) return;
        setAllowed(result.allowed);
        setReason(result.reason);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (!active || controller.signal.aborted) return;
        setAllowed(false);
        setError(toSettleKitError(cause));
        setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [customerId, feature, productId, requiredCredits, nonce]);

  return { allowed, reason, loading, error, refetch };
}
