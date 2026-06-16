"use client";

/**
 * Client-side providers for the demo.
 *
 * `SettleKitProvider` (from `@settlekit/react`) takes the current `customerId`
 * as a prop and feeds it to every SettleKit hook via context. Because the demo
 * lets you try any customer id, we keep that id in React state and re-render the
 * provider whenever it changes — which transparently re-runs the entitlement
 * checks for the new customer.
 *
 * We also expose a tiny `useDemoCustomer` context so the landing page input and
 * the gated export feature stay in sync.
 */
import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { SettleKitProvider } from "@settlekit/react";
import {
  SETTLEKIT_API_URL,
  SETTLEKIT_PUBLISHABLE_KEY,
} from "./settlekit.config";

interface DemoCustomerContextValue {
  customerId: string;
  setCustomerId: (id: string) => void;
}

const DemoCustomerContext = createContext<DemoCustomerContextValue | null>(null);

/** Read/update the customer id the demo is currently impersonating. */
export function useDemoCustomer(): DemoCustomerContextValue {
  const value = useContext(DemoCustomerContext);
  if (value === null) {
    throw new Error("useDemoCustomer must be used within <Providers>");
  }
  return value;
}

export function Providers({ children }: { children: ReactNode }) {
  const [customerId, setCustomerId] = useState("");

  const demoValue = useMemo<DemoCustomerContextValue>(
    () => ({ customerId, setCustomerId }),
    [customerId],
  );

  // Only pass `customerId` to the SDK once the user has entered one; until then
  // the SettleKit hooks correctly report "customer_unidentified".
  const trimmed = customerId.trim();

  return (
    <DemoCustomerContext.Provider value={demoValue}>
      <SettleKitProvider
        publishableKey={SETTLEKIT_PUBLISHABLE_KEY}
        baseUrl={SETTLEKIT_API_URL}
        {...(trimmed ? { customerId: trimmed } : {})}
      >
        {children}
      </SettleKitProvider>
    </DemoCustomerContext.Provider>
  );
}
