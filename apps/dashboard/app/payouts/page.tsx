import { api } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/format";
import {
  PageHeader,
  Card,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PayoutsPage() {
  const payouts = await api.payouts.list();
  return (
    <>
      <PageHeader
        title="Payouts"
        description="Settlements to your treasury wallet or bank, net of marketplace fees."
      />
      <ErrorBanner error={payouts.error} />
      <Card>
        <DataTable
          rows={payouts.data}
          getKey={(p) => p.id}
          empty={
            <EmptyState
              title="No payouts yet"
              message="Once you accumulate a balance, scheduled payouts to your destination appear here."
            />
          }
          columns={[
            { header: "ID", cell: (p) => <span className="mono">{p.id}</span> },
            { header: "Destination", cell: (p) => p.destination },
            { header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
            { header: "Arrival", cell: (p) => formatDate(p.arrivalDate) },
            { header: "Amount", align: "right", cell: (p) => formatMoney(p.amount) },
          ]}
        />
      </Card>
    </>
  );
}
