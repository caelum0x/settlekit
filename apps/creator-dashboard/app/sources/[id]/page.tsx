import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, DataTable, EmptyState, PageHeader, StatCard, StatGrid } from "@/components/ui";
import {
  getSourceDetail,
  listSourceSlugs,
  type LineageLeg,
  type ResolvedCitation,
} from "@/lib/data";
import { formatDateTime, formatNumber, formatUsdc, shortWallet } from "@/lib/format";

interface SourceDetailPageProps {
  params: { id: string };
}

/** Pre-render the known seed slugs; unknown slugs fall through to notFound(). */
export function generateStaticParams(): { id: string }[] {
  return listSourceSlugs().map((id) => ({ id }));
}

function depthBadge(depth: number) {
  return (
    <span className="badge badge-neutral">
      {depth === 0 ? "Author" : `Citation · L${depth}`}
    </span>
  );
}

export default function SourceDetailPage({ params }: SourceDetailPageProps) {
  const detail = getSourceDetail(params.id);
  if (detail === undefined) notFound();

  const { source, cites, legs, accesses, earnedByMe, citedByTitles } = detail;

  return (
    <>
      <div className="breadcrumb">
        <Link href="/sources">← Sources</Link>
      </div>

      <PageHeader title={source.title} description={source.summary} />

      <StatGrid>
        <StatCard label="Per-access toll" value={formatUsdc(source.priceUsdc)} hint="Charged each paid citation" />
        <StatCard label="Accesses" value={formatNumber(accesses)} hint="Paid accesses simulated" />
        <StatCard label="Earned by you" value={formatUsdc(earnedByMe.amount)} tone="good" hint="Author + recursive share" />
      </StatGrid>

      <Card title="Details">
        <dl className="detail-grid">
          <dt>Author</dt>
          <dd className="mono">{shortWallet(source.authorWallet)}</dd>
          <dt>Network</dt>
          <dd>{source.network}</dd>
          <dt>Price</dt>
          <dd className="mono">{formatUsdc(source.priceUsdc)}</dd>
          <dt>Created</dt>
          <dd>{formatDateTime(source.createdAt)}</dd>
          {citedByTitles.length > 0 ? (
            <>
              <dt>Cited by</dt>
              <dd>{citedByTitles.join(", ")}</dd>
            </>
          ) : null}
        </dl>
      </Card>

      <Card title="Citations & lineage">
        <p className="dim" style={{ fontSize: 13, marginTop: 0 }}>
          Works this source is grounded in (a share of every access routes onward),
          and the per-access royalty split across the citation lineage.
        </p>

        {cites.length > 0 ? (
          <DataTable<ResolvedCitation>
            rows={cites}
            getKey={(r) => r.sourceId}
            columns={[
              { header: "Cited work", cell: (r) => r.title },
              {
                header: "Share routed",
                align: "right",
                cell: (r) => <span className="mono">{(r.shareBps / 100).toFixed(2)}%</span>,
              },
            ]}
            empty={<EmptyState title="No citations" message="This source cites no other work." />}
          />
        ) : (
          <p className="dim" style={{ fontSize: 13 }}>
            This source cites no other work — it keeps the full author share.
          </p>
        )}

        <h3 className="card-title" style={{ marginTop: 20 }}>
          Royalty split per access
        </h3>
        <DataTable<LineageLeg>
          rows={legs}
          getKey={(r) => `${r.wallet}-${r.depth}`}
          columns={[
            { header: "Recipient", cell: (r) => <span className="mono">{shortWallet(r.wallet)}</span> },
            { header: "Tier", cell: (r) => depthBadge(r.depth) },
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
          empty={<EmptyState title="No lineage" message="No royalty legs were produced for this source." />}
        />
      </Card>
    </>
  );
}
