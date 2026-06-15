import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import {
  PageHeader,
  SubNav,
  Card,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";
import { SAAS_NAV } from "../nav";

export const dynamic = "force-dynamic";

export default async function SaasEntitlementsPage() {
  const entitlements = await api.saas.entitlements();
  return (
    <>
      <PageHeader
        title="SaaS Entitlements"
        description="Feature access granted to each subscriber, verifiable via the entitlement API."
      />
      <SubNav items={SAAS_NAV} />
      <ErrorBanner error={entitlements.error} />
      <Card>
        <DataTable
          rows={entitlements.data}
          getKey={(e) => e.id}
          empty={
            <EmptyState
              title="No SaaS entitlements yet"
              message="Subscribers receive entitlements automatically; verify them with POST /v1/saas/entitlements/verify."
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
