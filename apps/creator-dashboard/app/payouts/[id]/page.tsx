import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, DataTable, EmptyState, PageHeader, StatCard, StatGrid, StatusBadge } from "@/components/ui";
import { getPayoutDetail, type PayoutDepthGroup, type PayoutLeg } from "@/lib/data";
import { formatDateTime, formatNumber, formatUsdc } from "@/lib/format";

interface PayoutDetailPageProps {
  params: { id: string };
}

function depthBadge(depth: number) {
  return (
    <span className="badge badge-neutral">
      {depth === 0 ? "Author" : `Citation · L${depth}`}
    </span>
  );
}

export default function PayoutDetailPage({ params }: PayoutDetailPageProps) {
  const detail = getPayoutDetail(params.id);
  if (detail === undefined) notFound();

  const { settlementId, legs, total, lineCount, byDepth } = detail;

  return (
    <>
      <div className="breadcrumb">
        <Link href="/payouts">← Payouts</Link>
      </div>

      <PageHeader
        title={settlementId}
        description="Every royalty line in this gas-free on-chain sweep, with its recursive citation split."
      />

      <StatGrid>
        <StatCard label="Total swept" value={formatUsdc(total.amount)} tone="good" hint="Settled to your wallet" />
        <StatCard label="Lines batched" value={formatNumber(lineCount)} hint="Royalty legs in this sweep" />
      </StatGrid>

      <Card title="Royalty split by depth">
        <DataTable<PayoutDepthGroup>
          rows={byDepth}
          getKey={(r) => `depth-${r.depth}`}
          columns={[
            { header: "Tier", cell: (r) => depthBadge(r.depth) },
            { header: "Lines", align: "right", cell: (r) => <span className="mono">{formatNumber(r.lines)}</span> },
            {
              header: "Amount",
              align: "right",
              cell: (r) => (
                <span className="mono" style={{ color: "var(--good)", fontWeight: 600 }}>
                  +{formatUsdc(r.amount.amount)}
                </span>
              ),
            },
          ]}
          empty={<EmptyState title="No tiers" message="This sweep has no royalty legs." />}
        />
      </Card>

      <Card title="Lines in this sweep">
        <DataTable<PayoutLeg>
          rows={legs}
          getKey={(r) => `${r.accessId}-${r.depth}-${r.createdAt}`}
          columns={[
            { header: "Posted", cell: (r) => <span className="mono">{formatDateTime(r.createdAt)}</span> },
            { header: "Source", cell: (r) => r.sourceTitle },
            { header: "Tier", cell: (r) => depthBadge(r.depth) },
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
          empty={<EmptyState title="No lines" message="No royalty lines were settled in this sweep." />}
        />
      </Card>
    </>
  );
}
