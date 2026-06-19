import { Card, DataTable, EmptyState, PageHeader, StatCard, StatGrid, StatusBadge } from "@/components/ui";
import { getCreatorContext, type StatementLine } from "@/lib/data";
import { formatNumber, formatUsdc, formatDateTime } from "@/lib/format";

export default function StatementPage() {
  const ctx = getCreatorContext();
  const { totals, statement, me } = ctx;

  return (
    <>
      <PageHeader
        title="Statement"
        description={`Earnings for ${me.name} (${me.handle}) — your author share plus the recursive cut of everything that cites your work.`}
      />

      <StatGrid>
        <StatCard label="Lifetime earned" value={formatUsdc(totals.lifetime.amount)} tone="good" hint="Author + citation shares" />
        <StatCard label="Settled" value={formatUsdc(totals.settled.amount)} tone="good" hint="Paid out on-chain" />
        <StatCard label="Pending" value={formatUsdc(totals.pending.amount)} tone="warn" hint="Awaiting next sweep" />
        <StatCard label="Paying accesses" value={formatNumber(totals.payingAccesses)} hint="Citations that paid you" />
        <StatCard label="Sources" value={formatNumber(totals.sourcesAuthored)} hint="Works you authored" />
      </StatGrid>

      <Card title="Recent royalty lines">
        <DataTable<StatementLine>
          rows={statement}
          getKey={(r) => `${r.accessId}-${r.depth}-${r.createdAt}`}
          columns={[
            { header: "Posted", cell: (r) => <span className="mono">{formatDateTime(r.createdAt)}</span> },
            { header: "Source", cell: (r) => r.sourceTitle },
            {
              header: "Tier",
              cell: (r) => (
                <span className="badge badge-neutral">{r.depth === 0 ? "Author" : `Citation · L${r.depth}`}</span>
              ),
            },
            { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
            {
              header: "Credit",
              align: "right",
              cell: (r) => (
                <span className="mono" style={{ color: "var(--good)", fontWeight: 600 }}>
                  +{formatUsdc(r.amount.amount)}
                </span>
              ),
            },
          ]}
          empty={<EmptyState title="No earnings yet" message="When agents cite your sources, royalty lines will print here." />}
        />
      </Card>
    </>
  );
}
