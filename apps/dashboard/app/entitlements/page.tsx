import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import {
  PageHeader,
  Card,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function EntitlementsPage() {
  const entitlements = await api.entitlements.list();
  return (
    <>
      <PageHeader
        title="Entitlements"
        description="The universal access engine — every feature, repo, role, and key a customer holds."
      />
      <ErrorBanner error={entitlements.error} />
      <Card>
        <DataTable
          rows={entitlements.data}
          getKey={(e) => e.id}
          empty={
            <EmptyState
              title="No entitlements yet"
              message="When a payment succeeds, SettleKit grants entitlements that gate access to your products."
            />
          }
          columns={[
            { header: "Customer", cell: (e) => e.customerEmail },
            { header: "Feature", cell: (e) => <span className="mono">{e.feature}</span> },
            { header: "Source", cell: (e) => <span className="tag">{e.source}</span> },
            { header: "Status", cell: (e) => <StatusBadge status={e.status} /> },
            { header: "Granted", cell: (e) => formatDateTime(e.grantedAt) },
          ]}
        />
      </Card>
    </>
  );
}
