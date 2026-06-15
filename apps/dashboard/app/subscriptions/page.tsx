import { api } from "@/lib/api";
import { formatMoney, formatRelative } from "@/lib/format";
import {
  PageHeader,
  Card,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  const subs = await api.subscriptions.list();
  return (
    <>
      <PageHeader
        title="Subscriptions"
        description="Recurring SaaS plans, trials, and renewal status."
      />
      <ErrorBanner error={subs.error} />
      <Card>
        <DataTable
          rows={subs.data}
          getKey={(s) => s.id}
          empty={
            <EmptyState
              title="No subscriptions yet"
              message="Monthly and yearly plans appear here with their renewal dates."
            />
          }
          columns={[
            { header: "Customer", cell: (s) => s.customerEmail },
            { header: "Plan", cell: (s) => s.planName },
            { header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
            { header: "Renews", cell: (s) => formatRelative(s.currentPeriodEnd) },
            {
              header: "Amount",
              align: "right",
              cell: (s) => formatMoney(s.amount),
            },
          ]}
        />
      </Card>
    </>
  );
}
