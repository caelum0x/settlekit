import {
  entitlementsOfType,
  loadCustomerScope,
} from "@/lib/load";
import type { Entitlement } from "@/lib/types";
import { PageHeader, ErrorNote } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { CopyButton } from "@/components/CopyButton";
import {
  featureNumber,
  featureString,
  formatDate,
} from "@/lib/format";

/**
 * License keys are surfaced from the customer's `license_key` entitlements.
 * The entitlement's `resourceId` is the license key reference; `features` may
 * carry the displayable key, machine limit, and expiry mirrored at grant time.
 */
export default async function LicenseKeysPage({
  params,
}: {
  params: { customerId: string };
}) {
  const customerId = decodeURIComponent(params.customerId);
  const { entitlements, productNames, error } = await loadCustomerScope(customerId);
  const licenses = entitlementsOfType(entitlements, ["license_key"]);

  function keyValue(e: Entitlement): string {
    return featureString(e.features, "key") ?? e.resourceId ?? e.id;
  }

  const columns: Column<Entitlement>[] = [
    {
      key: "product",
      header: "Product",
      render: (e) => productNames.get(e.productId) ?? e.productId,
    },
    {
      key: "key",
      header: "License key",
      render: (e) => {
        const value = keyValue(e);
        return (
          <span className="key-cell">
            <span className="key-text">{value}</span>
            <CopyButton value={value} />
          </span>
        );
      },
    },
    {
      key: "machines",
      header: "Machines",
      render: (e) => {
        const limit = featureNumber(e.features, "machineLimit");
        const used = featureNumber(e.features, "activatedMachines");
        if (limit === null) return <span className="muted">—</span>;
        return `${used ?? 0} / ${limit}`;
      },
    },
    {
      key: "expiry",
      header: "Expiry",
      render: (e) =>
        e.expiresAt ? formatDate(e.expiresAt) : <span className="muted">No expiry</span>,
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
        title="License keys"
        description="Activation keys for the software you bought. Copy a key to activate a machine."
      />
      {error ? <ErrorNote message={error} /> : null}
      <DataTable
        columns={columns}
        rows={licenses}
        rowKey={(e) => e.id}
        emptyTitle="No license keys"
        emptyBody="When you buy a product delivered as a license key, it appears here with its machine limits."
      />
    </div>
  );
}
