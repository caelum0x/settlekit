import {
  entitlementsOfType,
  loadCustomerScope,
} from "@/lib/load";
import type { Entitlement } from "@/lib/types";
import { PageHeader, ErrorNote } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { CopyButton } from "@/components/CopyButton";
import { featureString, formatRelative } from "@/lib/format";

/**
 * API keys are surfaced from the customer's `api_access` / `api_credits`
 * entitlements. The non-secret key prefix, scopes, and last-used are mirrored
 * into the entitlement `features` at grant time (the secret is shown once at
 * issuance and never stored in plaintext).
 */
export default async function ApiKeysPage({
  params,
}: {
  params: { customerId: string };
}) {
  const customerId = decodeURIComponent(params.customerId);
  const { entitlements, productNames, error } = await loadCustomerScope(customerId);
  const keys = entitlementsOfType(entitlements, ["api_access", "api_credits"]);

  function scopesOf(e: Entitlement): string[] {
    const raw = e.features?.["scopes"];
    if (typeof raw === "string" && raw.length > 0) return raw.split(/[\s,]+/);
    return [];
  }

  const columns: Column<Entitlement>[] = [
    {
      key: "product",
      header: "Product",
      render: (e) => productNames.get(e.productId) ?? e.productId,
    },
    {
      key: "prefix",
      header: "Prefix",
      render: (e) => {
        const prefix = featureString(e.features, "keyPrefix");
        if (!prefix) return <span className="muted">—</span>;
        return (
          <span className="key-cell">
            <span className="key-text">{prefix}…</span>
            <CopyButton value={prefix} label="Copy" />
          </span>
        );
      },
    },
    {
      key: "scopes",
      header: "Scopes",
      render: (e) => {
        const scopes = scopesOf(e);
        if (scopes.length === 0) return <span className="muted">—</span>;
        return (
          <span>
            {scopes.map((s) => (
              <span className="tag" key={s}>
                {s}
              </span>
            ))}
          </span>
        );
      },
    },
    {
      key: "lastUsed",
      header: "Last used",
      render: (e) => formatRelative(featureString(e.features, "lastUsedAt")),
    },
    {
      key: "status",
      header: "Status",
      align: "right",
      render: (e) => <StatusBadge status={e.status} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="API keys"
        description="Keys that authenticate your API access. The full secret is shown once at creation and never stored."
      />
      {error ? <ErrorNote message={error} /> : null}
      <DataTable
        columns={columns}
        rows={keys}
        rowKey={(e) => e.id}
        emptyTitle="No API keys"
        emptyBody="When you buy API access, your scoped key prefix and usage appear here."
      />
    </div>
  );
}
