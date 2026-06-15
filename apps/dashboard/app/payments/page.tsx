import { api } from "@/lib/api";
import { formatMoney, formatDateTime } from "@/lib/format";
import {
  PageHeader,
  Card,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const payments = await api.payments.list();
  return (
    <>
      <PageHeader
        title="Payments"
        description="Every USDC settlement across the Arc, Circle, and x402 rails."
      />
      <ErrorBanner error={payments.error} />
      <Card>
        <DataTable
          rows={payments.data}
          getKey={(p) => p.id}
          empty={
            <EmptyState
              title="No payments yet"
              message="Settled charges appear here with their settlement rail and status."
            />
          }
          columns={[
            { header: "ID", cell: (p) => <span className="mono">{p.id}</span> },
            { header: "Customer", cell: (p) => p.customerEmail },
            { header: "Rail", cell: (p) => <span className="tag">{p.rail}</span> },
            { header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
            { header: "Date", cell: (p) => formatDateTime(p.createdAt) },
            {
              header: "Amount",
              align: "right",
              cell: (p) => formatMoney(p.amount),
            },
          ]}
        />
      </Card>
    </>
  );
}
