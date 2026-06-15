import { api } from "@/lib/api";
import { humanize } from "@/lib/format";
import {
  PageHeader,
  SubNav,
  Card,
  DataTable,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";
import { SAAS_NAV } from "../nav";

export const dynamic = "force-dynamic";

export default async function SaasFeaturesPage() {
  const features = await api.saas.features();
  return (
    <>
      <PageHeader
        title="SaaS Features"
        description="The feature flags and meters your plans grant — checked via the entitlement API."
      />
      <SubNav items={SAAS_NAV} />
      <ErrorBanner error={features.error} />
      <Card>
        <DataTable
          rows={features.data}
          getKey={(f) => f.id}
          empty={
            <EmptyState
              title="No features defined"
              message="Define boolean, metered, or seat features, then attach them to plans."
            />
          }
          columns={[
            { header: "Feature", cell: (f) => f.name },
            { header: "Key", cell: (f) => <span className="mono">{f.key}</span> },
            { header: "Type", cell: (f) => <span className="tag">{humanize(f.type)}</span> },
          ]}
        />
      </Card>
    </>
  );
}
