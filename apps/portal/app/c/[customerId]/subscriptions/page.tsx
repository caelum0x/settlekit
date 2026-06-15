import { api } from "@/lib/api";
import { loadCustomerScope, subscriptionIdsFrom } from "@/lib/load";
import type { Subscription } from "@/lib/types";
import { PageHeader, ErrorNote } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/format";

export default async function SubscriptionsPage({
  params,
}: {
  params: { customerId: string };
}) {
  const customerId = decodeURIComponent(params.customerId);
  const { entitlements, productNames, error } = await loadCustomerScope(customerId);

  const ids = subscriptionIdsFrom(entitlements);
  const results = await Promise.all(ids.map((id) => api.subscriptions.get(id)));
  const subscriptions = results
    .map((r) => r.data)
    .filter((s): s is Subscription => s !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const columns: Column<Subscription>[] = [
    {
      key: "plan",
      header: "Plan",
      render: (s) => productNames.get(s.productId) ?? s.productId,
    },
    {
      key: "period",
      header: "Current period",
      render: (s) => `${formatDate(s.currentPeriodStart)} – ${formatDate(s.currentPeriodEnd)}`,
    },
    {
      key: "renewal",
      header: "Renewal",
      render: (s) =>
        s.cancelAtPeriodEnd ? (
          <span className="muted">Cancels at period end</span>
        ) : (
          <span>Renews {formatDate(s.currentPeriodEnd)}</span>
        ),
    },
    {
      key: "grace",
      header: "Grace",
      render: (s) =>
        s.graceEndsAt ? (
          <span>Until {formatDate(s.graceEndsAt)}</span>
        ) : (
          <span className="muted">—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      align: "right",
      render: (s) => <StatusBadge status={s.status} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Subscriptions"
        description="Recurring plans you're subscribed to, with current period and renewal."
      />
      {error ? <ErrorNote message={error} /> : null}
      <DataTable
        columns={columns}
        rows={subscriptions}
        rowKey={(s) => s.id}
        emptyTitle="No subscriptions"
        emptyBody="Recurring plans you subscribe to will be listed here with their renewal dates."
      />
    </div>
  );
}
