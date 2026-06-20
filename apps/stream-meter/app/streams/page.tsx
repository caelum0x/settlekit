import { Card, DataTable, EmptyState, PageHeader, StatusBadge, SubNav } from "@/components/ui";
import { getMeterContext, type StreamView } from "@/lib/data";
import { formatUsdc, humanize, shortWallet } from "@/lib/format";

const SUBNAV = [
  { label: "Meter", href: "/" },
  { label: "Active streams", href: "/streams" },
  { label: "Checkpoints", href: "/settlements" },
];

export default async function StreamsPage() {
  const { streams } = await getMeterContext();

  return (
    <>
      <PageHeader
        title="Active streams"
        description="Every metered stream — Owncast broadcasts and Navidrome listens — with its parties, authorized rate, and live balances from the real stream snapshot."
      />

      <SubNav items={SUBNAV} />

      <Card title="Streams">
        <DataTable<StreamView>
          rows={streams}
          getKey={(r) => r.id}
          columns={[
            { header: "Stream", cell: (r) => <span className="mono">{r.id}</span> },
            { header: "Kind", cell: (r) => humanize(r.kind) },
            {
              header: "Parties",
              cell: (r) => (
                <span className="mono">
                  {shortWallet(r.payer)} → {shortWallet(r.payee)}
                </span>
              ),
            },
            {
              header: "Rate",
              cell: (r) => <span className="mono">{formatUsdc(r.ratePerSecondUsdc)}/s</span>,
            },
            { header: "State", cell: (r) => <StatusBadge status={r.snapshot.state} /> },
            {
              header: "Accrued",
              align: "right",
              cell: (r) => <span className="mono">{formatUsdc(r.snapshot.accruedUsdc)}</span>,
            },
            {
              header: "Settled",
              align: "right",
              cell: (r) => <span className="mono">{formatUsdc(r.snapshot.settledUsdc)}</span>,
            },
            {
              header: "Refundable",
              align: "right",
              cell: (r) => <span className="mono">{formatUsdc(r.snapshot.refundableUsdc)}</span>,
            },
          ]}
          empty={
            <EmptyState
              title="No streams"
              message="Open a stream to start metering per-second USDC payments."
            />
          }
        />
      </Card>
    </>
  );
}
