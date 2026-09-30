import { api } from "@/lib/api";
import { formatMoney, formatNumber, formatDate } from "@/lib/format";
import {
  PageHeader,
  StatGrid,
  StatCard,
  Card,
  EmptyState,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const [summary, metrics] = await Promise.all([api.analytics.summary(), api.analytics.metrics(30)]);
  const m = metrics.data;
  const pct = (x: number) => `${(x * 100).toFixed(1).replace(/\.0$/, "")}%`;
  const series = summary.revenueSeries;
  const max = series.reduce((m, p) => Math.max(m, p.amount), 0) || 1;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Revenue trends, recurring revenue, and access health over time."
      />
      <StatGrid>
        <StatCard label="Total revenue" value={formatMoney(summary.revenue)} tone="good" />
        <StatCard label="MRR" value={formatMoney(summary.mrr)} tone="default" />
        <StatCard label="Customers" value={formatNumber(summary.customers)} />
        <StatCard label="Active access" value={formatNumber(summary.activeAccess)} />
      </StatGrid>
      {m ? (
        <StatGrid>
          <StatCard label="Checkout conversion (30d)" value={`${pct(m.checkouts.conversion)} of ${formatNumber(m.checkouts.opened)}`} />
          <StatCard label="Subscription churn (30d)" value={pct(m.subscriptions.churnRate)} />
          <StatCard label="Revenue per customer" value={`$${m.averageRevenuePerCustomer}`} />
          <StatCard
            label="Subscriber lifetime value"
            value={m.subscriptions.estimatedLifetimeValue ? `$${m.subscriptions.estimatedLifetimeValue}` : "No churn yet"}
          />
        </StatGrid>
      ) : null}
      {m && m.links.length > 0 ? (
        <Card title="Payment links (30 days)">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th style={{ textAlign: "right" }}>Opened</th>
                <th style={{ textAlign: "right" }}>Paid</th>
                <th style={{ textAlign: "right" }}>Conversion</th>
                <th style={{ textAlign: "right" }}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {m.links.map((l) => (
                <tr key={l.productId}>
                  <td>{l.name}</td>
                  <td style={{ textAlign: "right" }}>{formatNumber(l.opened)}</td>
                  <td style={{ textAlign: "right" }}>{formatNumber(l.paid)}</td>
                  <td style={{ textAlign: "right" }}>{pct(l.conversion)}</td>
                  <td style={{ textAlign: "right" }}>${l.revenue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      <Card title="Revenue trend">
        {series.length === 0 ? (
          <EmptyState
            title="No revenue data yet"
            message="Daily revenue will be charted here once payments start flowing."
          />
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 6,
              height: 200,
              paddingTop: 12,
            }}
          >
            {series.map((point) => (
              <div
                key={point.date}
                title={`${formatDate(point.date)} · ${point.amount}`}
                style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}
              >
                <div
                  style={{
                    height: `${Math.max(4, (point.amount / max) * 180)}px`,
                    background: "var(--accent)",
                    borderRadius: "4px 4px 0 0",
                    opacity: 0.85,
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
