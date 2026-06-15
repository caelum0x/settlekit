"use client";

/**
 * useCheckout — creates checkout sessions and redirects the buyer to pay
 * (plan §4, §15). Wraps the API `/checkout-sessions` endpoint.
 */
import { useCallback, useState } from "react";
import type { CheckoutSession, SettleKitError } from "@settlekit/common";
import { apiRequest, toSettleKitError } from "./http.js";
import { useApiConnection } from "./provider.js";
import type { CreateCheckoutInput } from "./types.js";

/** Return shape of {@link useCheckout}. */
export interface UseCheckoutResult {
  /** Create a checkout session; resolves with the persisted session. */
  createCheckout: (input: CreateCheckoutInput) => Promise<CheckoutSession>;
  /** Navigate the browser to the hosted checkout page for a session. */
  redirectToCheckout: (sessionId: string) => void;
  /** True while a create request is in flight. */
  loading: boolean;
  /** The error from the most recent failed create, if any. */
  error: SettleKitError | null;
}

/** Hook for creating and redirecting to SettleKit checkout sessions. */
export function useCheckout(): UseCheckoutResult {
  const connection = useApiConnection();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SettleKitError | null>(null);

  const createCheckout = useCallback(
    async (input: CreateCheckoutInput): Promise<CheckoutSession> => {
      setLoading(true);
      setError(null);
      try {
        const session = await apiRequest<CheckoutSession>(connection, {
          path: "/checkout-sessions",
          method: "POST",
          body: input,
        });
        return session;
      } catch (cause) {
        const normalized = toSettleKitError(cause);
        setError(normalized);
        throw normalized;
      } finally {
        setLoading(false);
      }
    },
    [connection],
  );

  const redirectToCheckout = useCallback(
    (sessionId: string): void => {
      if (typeof window === "undefined") return;
      const base = connection.baseUrl.replace(/\/+$/, "");
      window.location.assign(`${base}/checkout/${encodeURIComponent(sessionId)}`);
    },
    [connection],
  );

  return { createCheckout, redirectToCheckout, loading, error };
}
