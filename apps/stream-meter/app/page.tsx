import { PageHeader, StatCard, StatGrid, SubNav } from "@/components/ui";
import { LiveMeter } from "@/components/LiveMeter";
import { LIVE_SEED, getMeterContext } from "@/lib/data";
import { formatNumber, formatUsdc } from "@/lib/format";

const SUBNAV = [
  { label: "Meter", href: "/" },
  { label: "Active streams", href: "/streams" },
  { label: "Checkpoints", href: "/settlements" },
];

export default async function MeterPage() {
  const { totals } = await getMeterContext();

  return (
    <>
      <PageHeader
        title="Stream Meter"
        description="Per-second USDC streaming payments (Lepton RFB 4). Value accrues in real time as a broadcast or listen is delivered, pauses the instant flow drops, and settles in gas-free checkpoints."
      />

      <SubNav items={SUBNAV} />

      <StatGrid>
        <StatCard label="Active streams" value={formatNumber(totals.activeStreams)} hint="Owncast + Navidrome" />
        <StatCard label="Accrued" value={formatUsdc(totals.accrued.amount)} tone="good" hint="Metered so far" />
        <StatCard label="Settled" value={formatUsdc(totals.settled.amount)} tone="good" hint="Batched on-chain" />
        <StatCard label="Due" value={formatUsdc(totals.due.amount)} tone="warn" hint="Awaiting next checkpoint" />
        <StatCard label="Refundable" value={formatUsdc(totals.refundable.amount)} hint="Reserved, unused" />
      </StatGrid>

      <LiveMeter
        ratePerSecondUsdc={LIVE_SEED.ratePerSecondUsdc}
        reserveUsdc={LIVE_SEED.reserveUsdc}
        payer={LIVE_SEED.payer}
        payee={LIVE_SEED.payee}
      />
    </>
  );
}
