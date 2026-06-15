import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import {
  PageHeader,
  Card,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function LicenseKeysPage() {
  const keys = await api.licenseKeys.list();
  return (
    <>
      <PageHeader
        title="License Keys"
        description="Issued, activated, and revoked keys across your products."
      />
      <ErrorBanner error={keys.error} />
      <Card>
        <DataTable
          rows={keys.data}
          getKey={(k) => k.id}
          empty={
            <EmptyState
              title="No license keys issued"
              message="Set a product's delivery action to “Issue license key” and keys will be generated on purchase."
            />
          }
          columns={[
            { header: "Key", cell: (k) => <span className="mono">{k.key}</span> },
            { header: "Customer", cell: (k) => k.customerEmail },
            { header: "Product", cell: (k) => k.productName },
            {
              header: "Activations",
              cell: (k) =>
                `${formatNumber(k.activations)} / ${formatNumber(k.maxActivations)}`,
            },
            { header: "Status", cell: (k) => <StatusBadge status={k.status} /> },
          ]}
        />
      </Card>
    </>
  );
}
