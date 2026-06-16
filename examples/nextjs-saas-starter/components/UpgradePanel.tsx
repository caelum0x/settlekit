"use client";

/**
 * The paywall fallback shown when the current customer is NOT entitled to
 * `ai_export`. It uses the real `<UpgradeButton>` from `@settlekit/react`, which
 * creates a SettleKit checkout session (POST /v1/checkout-sessions) and then
 * redirects the buyer to the hosted checkout page for the returned session.
 */
import { useState } from "react";
import { UpgradeButton } from "@settlekit/react";
import type { CreateCheckoutInput } from "@settlekit/react";
import { useDemoCustomer } from "../app/providers";
import {
  DEMO_MERCHANT_ID,
  DEMO_NETWORK,
  DEMO_ORGANIZATION_ID,
  DEMO_PAY_TO_ADDRESS,
  DEMO_PRO_PRICE_ID,
} from "../app/settlekit.config";

interface UpgradePanelProps {
  /** Why the customer is gated, surfaced from useEntitlement().reason. */
  reason?: string;
}

export function UpgradePanel({ reason }: UpgradePanelProps) {
  const { customerId } = useDemoCustomer();
  const [error, setError] = useState<string | null>(null);

  const trimmed = customerId.trim();

  const checkoutInput: CreateCheckoutInput = {
    organizationId: DEMO_ORGANIZATION_ID,
    merchantId: DEMO_MERCHANT_ID,
    ...(trimmed ? { customerId: trimmed } : {}),
    items: [{ priceId: DEMO_PRO_PRICE_ID, quantity: 1 }],
    payToAddress: DEMO_PAY_TO_ADDRESS,
    network: DEMO_NETWORK,
    successUrl:
      typeof window !== "undefined" ? `${window.location.origin}/export` : undefined,
    cancelUrl:
      typeof window !== "undefined" ? `${window.location.origin}/` : undefined,
  };

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Unlock AI Export with Pro</h3>
        <span className="status">
          <span className="dot dot--bad" />
          Locked
        </span>
      </div>

      <p className="muted" style={{ marginTop: 8 }}>
        The <strong>AI Export</strong> feature is part of the Pro plan. Upgrade to
        let AI Export Pro turn your raw data into a polished, presentation-ready
        export.
        {reason ? (
          <>
            {" "}
            <span className="muted">
              (entitlement reason: <code>{reason}</code>)
            </span>
          </>
        ) : null}
      </p>

      <ul className="features">
        <li>AI-generated narrative summaries</li>
        <li>PDF, CSV and Notion export targets</li>
        <li>Unlimited exports per month</li>
      </ul>

      <div className="row" style={{ marginTop: 16 }}>
        <UpgradeButton
          className="btn btn--primary"
          input={checkoutInput}
          onError={(err) =>
            setError(err instanceof Error ? err.message : "Checkout failed")
          }
        >
          Upgrade to Pro
        </UpgradeButton>
        <span className="muted" style={{ fontSize: 13 }}>
          Starts a real SettleKit checkout session.
        </span>
      </div>

      {error ? (
        <div className="callout callout--bad" style={{ marginTop: 14 }}>
          Could not start checkout: {error}
          <br />
          For a no-payment demo, grant the <code>ai_export</code> entitlement to
          this customer via the SettleKit API (see the README walkthrough), then
          reload.
        </div>
      ) : null}
    </div>
  );
}
