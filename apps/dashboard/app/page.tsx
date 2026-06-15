import Link from "next/link";
import { api } from "@/lib/api";
import {
  formatMoney,
  formatNumber,
  formatDate,
  formatRelative,
} from "@/lib/format";
import {
  PageHeader,
  StatGrid,
  StatCard,
  Card,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [summary, payments, subscriptions, runs] = await Promise.all([
    api.analytics.summary(),
    api.payments.list(),
    api.subscriptions.list(),
    api.delivery.runs(),
  ]);

  const recentPayments = payments.data.slice(0, 6);
  const expiringSubs = subscriptions.data
    .filter((s) => s.status === "active" || s.status === "trialing")
    .slice(0, 6);
  const failedRuns = runs.data.filter((r) => r.status === "failed").slice(0, 6);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Revenue, customers, active access, expiring subscriptions, and delivery health."
        action={
          <Link href="/products/new" className="btn btn-primary">
            + Create Product
          </Link>
        }
      />

      <ErrorBanner error={payments.error} />

      <StatGrid>
        <StatCard
          label="Revenue"
          value={formatMoney(summary.revenue)}
          hint={`MRR ${formatMoney(summary.mrr)}`}
          tone="good"
        />
        <StatCard
          label="Customers"
          value={formatNumber(summary.customers)}
          hint="Lifetime accounts"
        />
        <StatCard
          label="Active access"
          value={formatNumber(summary.activeAccess)}
          hint="Live entitlements"
        />
        <StatCard
          label="Expiring subs"
          value={formatNumber(summary.expiringSubscriptions)}
          hint="Renewing soon"
          tone="warn"
        />
        <StatCard
          label="Failed deliveries"
          value={formatNumber(summary.failedDeliveries)}
          hint="Need attention"
          tone={summary.failedDeliveries > 0 ? "bad" : "good"}
        />
      </StatGrid>

      <Card title="Recent payments">
        <DataTable
          rows={recentPayments}
          getKey={(p) => p.id}
          empty={
            <EmptyState
              title="No payments yet"
              message="Once buyers pay in USDC, transactions appear here in real time."
            />
          }
          columns={[
            { header: "Customer", cell: (p) => p.customerEmail },
            { header: "Rail", cell: (p) => <span className="tag">{p.rail}</span> },
            { header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
            { header: "Date", cell: (p) => formatDate(p.createdAt) },
            {
              header: "Amount",
              align: "right",
              cell: (p) => formatMoney(p.amount),
            },
          ]}
        />
      </Card>

      <Card title="Expiring subscriptions">
        <DataTable
          rows={expiringSubs}
          getKey={(s) => s.id}
          empty={
            <EmptyState
              title="No active subscriptions"
              message="Recurring SaaS plans and renewals will be tracked here."
            />
          }
          columns={[
            { header: "Customer", cell: (s) => s.customerEmail },
            { header: "Plan", cell: (s) => s.planName },
            { header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
            {
              header: "Renews",
              cell: (s) => formatRelative(s.currentPeriodEnd),
            },
            {
              header: "Amount",
              align: "right",
              cell: (s) => formatMoney(s.amount),
            },
          ]}
        />
      </Card>

      <Card title="Failed deliveries">
        <DataTable
          rows={failedRuns}
          getKey={(r) => r.id}
          empty={
            <EmptyState
              title="All deliveries healthy"
              message="Failed access-grant runs (GitHub invites, license keys, webhooks) show up here for retry."
            />
          }
          columns={[
            { header: "Product", cell: (r) => r.productName },
            { header: "Customer", cell: (r) => r.customerEmail },
            { header: "Action", cell: (r) => <span className="tag">{r.action}</span> },
            { header: "Attempts", cell: (r) => formatNumber(r.attempts) },
            {
              header: "",
              align: "right",
              cell: () => (
                <Link href="/delivery/runs" className="muted">
                  View runs →
                </Link>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}
