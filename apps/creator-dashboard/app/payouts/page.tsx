import { Card, DataTable, EmptyState, PageHeader, StatCard, StatGrid } from "@/components/ui";
import { getCreatorContext, type PayoutSweep } from "@/lib/data";
import { formatNumber, formatUsdc } from "@/lib/format";

export default function PayoutsPage() {
  const { payouts, totals } = getCreatorContext();

  return (
    <>
      <PageHeader
        eyebrow="Earnings"
        title="Payouts"
        description="Settled sweeps roll your accrued royalty lines into one gas-free on-chain settlement per batch."
      />

      <StatGrid>
        <StatCard label="Settled" value={formatUsdc(totals.settled.amount)} tone="good" hint={`${payouts.length} sweeps`} />
        <StatCard label="Pending" value={formatUsdc(totals.pending.amount)} tone="warn" hint="Included in the next sweep" />
        <StatCard label="Lifetime" value={formatUsdc(totals.lifetime.amount)} hint="All royalty lines" />
      </StatGrid>

      <Card title="Settlement sweeps">
        <DataTable<PayoutSweep>
          rows={payouts}
          getKey={(r) => r.settlementId}
          columns={[
            { header: "Settlement", cell: (r) => <span className="mono">{r.settlementId}</span> },
            { header: "Lines batched", align: "right", cell: (r) => <span className="mono">{formatNumber(r.legs)}</span> },
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
          empty={<EmptyState title="No payouts yet" message="Once royalty lines are swept, settlements will list here." />}
        />
      </Card>
    </>
  );
}
