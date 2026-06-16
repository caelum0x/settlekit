"use client";

/**
 * Gates the AI Export feature behind the `ai_export` SettleKit entitlement.
 *
 * We read entitlement state with `useEntitlement` (so we can show the loading
 * spinner, the resolved reason, and offer a manual "Re-check" after granting the
 * entitlement out-of-band) and ALSO render `<Paywall>` — the canonical
 * declarative gate from `@settlekit/react` — for the actual show/hide decision.
 */
import { Paywall, useEntitlement } from "@settlekit/react";
import { ExportButton } from "./ExportButton";
import { UpgradePanel } from "./UpgradePanel";
import { useDemoCustomer } from "../app/providers";
import { AI_EXPORT_FEATURE } from "../app/settlekit.config";

function ResolvingPanel() {
  return (
    <div className="panel">
      <span className="status">
        <span className="spinner" /> Checking your entitlement…
      </span>
    </div>
  );
}

export function GatedExport() {
  const { customerId } = useDemoCustomer();
  const { allowed, reason, loading, error, refetch } =
    useEntitlement(AI_EXPORT_FEATURE);

  const trimmed = customerId.trim();

  if (!trimmed) {
    return (
      <div className="callout">
        Enter a customer id above to check whether they can use AI Export.
      </div>
    );
  }

  return (
    <div>
      <div
        className="row"
        style={{ justifyContent: "space-between", marginBottom: 12 }}
      >
        <span className="muted" style={{ fontSize: 13 }}>
          Customer <code>{trimmed}</code> ·{" "}
          {loading
            ? "verifying…"
            : allowed
              ? "entitled to ai_export"
              : `not entitled (${reason ?? "unknown"})`}
        </span>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => refetch()}
          disabled={loading}
        >
          Re-check
        </button>
      </div>

      {error ? (
        <div className="callout callout--bad" style={{ marginBottom: 12 }}>
          Entitlement check failed: {error.message}. Is the SettleKit API running
          at the configured URL?
        </div>
      ) : null}

      <Paywall
        feature={AI_EXPORT_FEATURE}
        loading={<ResolvingPanel />}
        fallback={<UpgradePanel reason={reason} />}
      >
        <ExportButton />
      </Paywall>
    </div>
  );
}
