import { Card, DataTable, EmptyState, PageHeader, StatCard, StatGrid, SubNav } from "@/components/ui";
import { getMeterContext, type SettlementView } from "@/lib/data";
import { formatDateTime, formatNumber, formatUsdc, humanize } from "@/lib/format";

const SUBNAV = [
  { label: "Meter", href: "/" },
  { label: "Active streams", href: "/streams" },
  { label: "Checkpoints", href: "/settlements" },
];

export default async function SettlementsPage() {
  const { settlements, totals } = await getMeterContext();

  return (
    <>
      <PageHeader
        title="Settlement checkpoints"
        description="Each checkpoint batches a stream's accrued-but-unsettled value into one gas-free on-chain settlement. Captured from the real settle() calls."
      />

      <SubNav items={SUBNAV} />

      <StatGrid>
        <StatCard label="Settled total" value={formatUsdc(totals.settled.amount)} tone="good" hint="Across all streams" />
        <StatCard label="Checkpoints" value={formatNumber(settlements.length)} hint="Batched settlements" />
        <StatCard label="Due" value={formatUsdc(totals.due.amount)} tone="warn" hint="Awaiting next checkpoint" />
      </StatGrid>

      <Card title="Checkpoints">
        <DataTable<SettlementView>
          rows={settlements}
          getKey={(r) => `${r.streamId}-${r.at}-${r.settledTotal}`}
          columns={[
            { header: "At", cell: (r) => <span className="mono">{formatDateTime(r.at)}</span> },
            { header: "Stream", cell: (r) => <span className="mono">{r.streamId}</span> },
            { header: "Kind", cell: (r) => humanize(r.kind) },
            {
              header: "Batch amount",
              align: "right",
              cell: (r) => (
                <span className="mono" style={{ color: "var(--good)", fontWeight: 600 }}>
                  +{formatUsdc(r.amount)}
                </span>
              ),
            },
            {
              header: "Settled total",
              align: "right",
              cell: (r) => <span className="mono">{formatUsdc(r.settledTotal)}</span>,
            },
          ]}
          empty={
            <EmptyState
              title="No checkpoints yet"
              message="Once a stream settles its accrued value, checkpoints will list here."
            />
          }
        />
      </Card>
    </>
  );
}
