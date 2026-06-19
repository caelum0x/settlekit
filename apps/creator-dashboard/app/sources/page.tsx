import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { getCreatorContext, type SourceStat } from "@/lib/data";
import { formatNumber, formatUsdc } from "@/lib/format";

export default function SourcesPage() {
  const { sources } = getCreatorContext();
  const mine = sources.filter((s) => s.isMine);
  const others = sources.filter((s) => !s.isMine);

  return (
    <>
      <PageHeader
        title="Sources"
        description="Your priced, citeable works — and the works you cite, which route a share back to their authors."
      />

      <Card title="Authored by you">
        <DataTable<SourceStat>
          rows={mine}
          getKey={(r) => r.id}
          columns={[
            { header: "Title", cell: (r) => r.title },
            { header: "Per-access toll", cell: (r) => <span className="mono">{formatUsdc(r.priceUsdc)}</span> },
            { header: "Accesses", align: "right", cell: (r) => <span className="mono">{formatNumber(r.accesses)}</span> },
            { header: "Cites", cell: (r) => (r.citesCount > 0 ? <StatusBadge status="active" /> : <span className="dim">—</span>) },
            {
              header: "Earned by you",
              align: "right",
              cell: (r) => (
                <span className="mono" style={{ color: "var(--good)", fontWeight: 600 }}>
                  +{formatUsdc(r.earnedByMe.amount)}
                </span>
              ),
            },
          ]}
          empty={<EmptyState title="No sources" message="Register a source to start charging per-citation tolls." />}
        />
      </Card>

      <Card title="Works you cite">
        <DataTable<SourceStat>
          rows={others}
          getKey={(r) => r.id}
          columns={[
            { header: "Title", cell: (r) => r.title },
            { header: "Per-access toll", cell: (r) => <span className="mono">{formatUsdc(r.priceUsdc)}</span> },
            { header: "Accesses", align: "right", cell: (r) => <span className="mono">{formatNumber(r.accesses)}</span> },
            {
              header: "Your recursive cut",
              align: "right",
              cell: (r) => (
                <span className="mono" style={{ color: r.earnedByMe.amount === "0" ? "var(--text-dim)" : "var(--good)", fontWeight: 600 }}>
                  {r.earnedByMe.amount === "0" ? "—" : `+${formatUsdc(r.earnedByMe.amount)}`}
                </span>
              ),
            },
          ]}
          empty={<EmptyState title="No citations" message="Sources you cite will appear here." />}
        />
      </Card>
    </>
  );
}
