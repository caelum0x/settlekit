"use client";

/**
 * Lets the demo impersonate any customer by typing their SettleKit customer id.
 * Updating the value re-renders <SettleKitProvider> with the new `customerId`,
 * which transparently re-runs every entitlement check below.
 */
import { useDemoCustomer } from "../app/providers";

export function CustomerIdInput() {
  const { customerId, setCustomerId } = useDemoCustomer();

  return (
    <div className="panel">
      <div className="field">
        <label htmlFor="customerId">Customer id (try any value)</label>
        <input
          id="customerId"
          className="input"
          placeholder="e.g. cus_alice"
          value={customerId}
          onChange={(event) => setCustomerId(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <p className="muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
        SettleKit checks the <code>ai_export</code> entitlement for this customer.
        A customer with the Pro plan granted sees the feature; everyone else hits
        the paywall.
      </p>
    </div>
  );
}
