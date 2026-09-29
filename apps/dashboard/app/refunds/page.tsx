import { api } from "@/lib/api";
import { formatMoneyDecimal, formatDate, humanize } from "@/lib/format";
import {
  PageHeader,
  Card,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";
import type { Refund } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function RefundsPage() {
  const refunds = await api.refunds.list();
  return (
    <>
      <PageHeader
        title="Refunds"
        description="Refund from a payment's page: SettleKit sends the funds back on-chain from the operator wallet (Base escrow payments through the escrow), or you record a refund you sent yourself. Refunds can never exceed the original payment."
      />
      <ErrorBanner error={refunds.error} />
      <Card title="Refunds">
        <DataTable<Refund>
          rows={refunds.data}
          getKey={(r) => r.id}
          empty={
            <EmptyState
              title="No refunds yet"
              message="Open a payment under Payments and choose Refund payment."
            />
          }
          columns={[
            { header: "ID", cell: (r) => <span className="mono">{r.id}</span> },
            {
              header: "Payment",
              cell: (r) => (
                <a className="link mono" href={`/payments/${encodeURIComponent(r.paymentId)}`}>
                  {r.paymentId}
                </a>
              ),
            },
            { header: "Customer", cell: (r) => <span className="mono">{r.customerId}</span> },
            { header: "Reason", cell: (r) => humanize(r.reason) },
            { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
            { header: "Created", cell: (r) => formatDate(r.createdAt) },
            { header: "Amount", align: "right", cell: (r) => formatMoneyDecimal(r.amount) },
          ]}
        />
      </Card>
    </>
  );
}
