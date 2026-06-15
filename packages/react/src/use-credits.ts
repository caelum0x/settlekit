"use client";

/**
 * useCredits — reports the remaining API/usage credits for the current customer
 * on a given product (plan §4). Reads the customer's entitlements from the API
 * and sums the credits for the matching product.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Entitlement, SettleKitError } from "@settlekit/common";
import { apiRequest, toSettleKitError } from "./http.js";
import { useApiConnection, useSettleKit } from "./provider.js";

/** Return shape of {@link useCredits}. */
export interface UseCreditsResult {
  /** Remaining credits across active entitlements for the product. */
  creditsRemaining: number;
  /** True while a request is in flight. */
  loading: boolean;
  /** The error from the most recent failed request, if any. */
  error: SettleKitError | null;
  /** Re-fetch the credit balance on demand. */
  refetch: () => void;
}

/** Read remaining credits for the current customer on a product. */
export function useCredits(productId: string): UseCreditsResult {
  const connection = useApiConnection();
  const { customerId } = useSettleKit();

  const [creditsRemaining, setCreditsRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<SettleKitError | null>(null);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  const connectionRef = useRef(connection);
  connectionRef.current = connection;

  useEffect(() => {
    if (!customerId) {
      setCreditsRemaining(0);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError(null);

    apiRequest<Entitlement[]>(connectionRef.current, {
      path: "/entitlements",
      method: "GET",
      signal: controller.signal,
      query: { customerId, productId, activeOnly: true },
    })
      .then((entitlements) => {
        if (!active) return;
        const total = entitlements.reduce(
          (sum, ent) => sum + (ent.creditsRemaining ?? 0),
          0,
        );
        setCreditsRemaining(total);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (!active || controller.signal.aborted) return;
        setCreditsRemaining(0);
        setError(toSettleKitError(cause));
        setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [customerId, productId, nonce]);

  return { creditsRemaining, loading, error, refetch };
}
