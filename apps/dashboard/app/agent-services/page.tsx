import Link from "next/link";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import {
  PageHeader,
  Card,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AgentServicesPage() {
  const services = await api.agentServices.list();
  return (
    <>
      <PageHeader
        title="Agent Services"
        description="Machine-payable services AI agents can discover and pay for per call via x402."
        action={
          <Link href="/agent-services/new" className="btn btn-primary">
            + New Service
          </Link>
        }
      />
      <ErrorBanner error={services.error} />
      <Card>
        <DataTable
          rows={services.data}
          getKey={(s) => s.id}
          empty={
            <EmptyState
              title="No agent services yet"
              message="Publish a service with an agent-readable metadata.json so agents can buy it autonomously."
              action={
                <Link href="/agent-services/new" className="btn btn-primary">
                  Create service
                </Link>
              }
            />
          }
          columns={[
            {
              header: "Name",
              cell: (s) => (
                <Link href={`/agent-services/${s.id}`} className="mono">
                  {s.name}
                </Link>
              ),
            },
            { header: "Endpoint", cell: (s) => <span className="mono">{s.endpoint}</span> },
            { header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
            {
              header: "Price / call",
              align: "right",
              cell: (s) => formatMoney(s.pricePerCall),
            },
          ]}
        />
      </Card>
    </>
  );
}
