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
  const summary = await api.analytics.summary();
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
