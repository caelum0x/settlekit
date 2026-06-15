"use client";

/**
 * SettleKit React context provider and accessor hook (plan §4).
 *
 * Wrap your app once with <SettleKitProvider> to supply the API connection and
 * the current customer; every SettleKit hook reads from this context.
 */
import { createContext, createElement, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { SettleKitError } from "@settlekit/common";
import type { ApiConnection } from "./http.js";

/** The value held by the SettleKit context. */
export interface SettleKitContextValue {
  /** Publishable or secret API key used for Bearer auth. */
  apiKey: string;
  /** API origin, e.g. `https://api.settlekit.com`. */
  baseUrl: string;
  /** The signed-in customer whose entitlements/credits are checked. */
  customerId?: string;
}

/** Props for {@link SettleKitProvider}. */
export interface SettleKitProviderProps {
  /** Publishable/secret API key. Alias of {@link publishableKey}. */
  apiKey?: string;
  /** Publishable key (frontend-safe). Alias of {@link apiKey}. */
  publishableKey?: string;
  /** API origin. Defaults to `https://api.settlekit.com`. */
  baseUrl?: string;
  /** The current customer id. */
  customerId?: string;
  children: ReactNode;
}

const DEFAULT_BASE_URL = "https://api.settlekit.com";

const SettleKitContext = createContext<SettleKitContextValue | null>(null);

/** Provides SettleKit configuration to descendant hooks/components. */
export function SettleKitProvider(props: SettleKitProviderProps): ReactNode {
  const { apiKey, publishableKey, baseUrl, customerId, children } = props;
  const key = apiKey ?? publishableKey;

  const value = useMemo<SettleKitContextValue>(() => {
    if (!key) {
      throw new SettleKitError({
        code: "validation_error",
        message: "SettleKitProvider requires `apiKey` or `publishableKey`",
      });
    }
    return {
      apiKey: key,
      baseUrl: baseUrl ?? DEFAULT_BASE_URL,
      ...(customerId !== undefined ? { customerId } : {}),
    };
  }, [key, baseUrl, customerId]);

  return createElement(SettleKitContext.Provider, { value }, children);
}

/** Read the SettleKit context; throws when used outside a provider. */
export function useSettleKit(): SettleKitContextValue {
  const value = useContext(SettleKitContext);
  if (value === null) {
    throw new SettleKitError({
      code: "validation_error",
      message: "useSettleKit must be used within a <SettleKitProvider>",
    });
  }
  return value;
}

/** Derive the HTTP connection from the current context value. */
export function useApiConnection(): ApiConnection {
  const { apiKey, baseUrl } = useSettleKit();
  return useMemo<ApiConnection>(() => ({ apiKey, baseUrl }), [apiKey, baseUrl]);
}
