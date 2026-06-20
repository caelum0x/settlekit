import { DataTable, EmptyState, PageHeader, StatCard, StatGrid, StatusBadge } from "@/components/ui";
import { getCreatorContext, type StatementLine } from "@/lib/data";
import { formatNumber, formatUsdc, formatDateTime } from "@/lib/format";
import { addMoney, money } from "@settlekit/common";

function tierCell(depth: number) {
  if (depth === 0) return <span className="tier tier-author">Author</span>;
  return (
    <span className="tier tier-cite" style={{ paddingLeft: `${(depth - 1) * 12}px` }}>
      Citation · L{depth}
    </span>
  );
}

export default function StatementPage() {
  const ctx = getCreatorContext();
  const { totals, statement, me } = ctx;

  // The foot nets exactly the lines printed on this statement — conserved to
  // the sub-cent, the way a real settlement statement balances.
  const netShown = statement.reduce((acc, l) => addMoney(acc, l.amount), money("0"));
  const period = statement.length > 0 ? formatDateTime(statement[0].createdAt) : "—";

  return (
    <>
      <PageHeader
        eyebrow="Earnings"
        title="Statement"
        description={`Your author share plus the recursive cut of everything that cites your work — every royalty line ${me.name} earned, printed as it settled.`}
        reference={{ label: "Statement ref", value: "SK-CR-0001" }}
      />

      <StatGrid>
        <StatCard label="Lifetime earned" value={formatUsdc(totals.lifetime.amount)} tone="good" hint="Author + citation shares" />
        <StatCard label="Settled" value={formatUsdc(totals.settled.amount)} tone="good" hint="Paid out on-chain" />
        <StatCard label="Pending" value={formatUsdc(totals.pending.amount)} tone="warn" hint="Awaiting next sweep" />
        <StatCard label="Paying accesses" value={formatNumber(totals.payingAccesses)} hint="Citations that paid you" />
        <StatCard label="Sources" value={formatNumber(totals.sourcesAuthored)} hint="Works you authored" />
      </StatGrid>

      <section className="statement-doc" aria-label="Settlement statement of recent royalty lines">
        <div className="statement-doc-head">
          <div>
            <div className="statement-doc-title">Settlement Statement</div>
            <div className="statement-doc-sub">
              {me.name} · {me.handle} · arc · USDC ledger
            </div>
          </div>
          <div className="statement-doc-ref">
            Posted through
            <b>{period}</b>
          </div>
        </div>

        <div className="statement-doc-body">
          <DataTable<StatementLine>
            rows={statement}
            getKey={(r) => `${r.accessId}-${r.depth}-${r.createdAt}`}
            columns={[
              { header: "Posted", cell: (r) => <span className="mono">{formatDateTime(r.createdAt)}</span> },
              { header: "Source", cell: (r) => r.sourceTitle },
              { header: "Tier", cell: (r) => tierCell(r.depth) },
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
        </div>

        {statement.length > 0 ? (
          <div className="statement-doc-foot">
            <span className="statement-doc-foot-label">
              Net on this statement · {statement.length} {statement.length === 1 ? "line" : "lines"}
            </span>
            <span className="statement-doc-total">+{formatUsdc(netShown.amount)}</span>
          </div>
        ) : null}
      </section>

      <p className="statement-note">
        Lines accrue per access and sweep into gas-free on-chain settlements — see Payouts for the batches.
      </p>
    </>
  );
}
