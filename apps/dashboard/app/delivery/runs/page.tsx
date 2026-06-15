import { api } from "@/lib/api";
import { formatDateTime, humanize } from "@/lib/format";
import {
  PageHeader,
  SubNav,
  Card,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";

export const dynamic = "force-dynamic";

const DELIVERY_NAV = [
  { label: "Runs", href: "/delivery/runs" },
  { label: "Logs", href: "/delivery/logs" },
];

export default async function DeliveryRunsPage() {
  const runs = await api.delivery.runs();
  return (
    <>
      <PageHeader
        title="Delivery Runs"
        description="Every access-grant attempt — GitHub invites, license keys, webhooks, and more."
      />
      <SubNav items={DELIVERY_NAV} />
      <ErrorBanner error={runs.error} />
      <Card>
        <DataTable
          rows={runs.data}
          getKey={(r) => r.id}
          empty={
            <EmptyState
              title="No delivery runs yet"
              message="When a payment triggers an access action, the run and its result show up here."
            />
          }
          columns={[
            { header: "Product", cell: (r) => r.productName },
            { header: "Customer", cell: (r) => r.customerEmail },
            { header: "Action", cell: (r) => <span className="tag">{humanize(r.action)}</span> },
            { header: "Attempts", cell: (r) => String(r.attempts) },
            { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
            { header: "Started", cell: (r) => formatDateTime(r.startedAt) },
          ]}
        />
      </Card>
    </>
  );
}
