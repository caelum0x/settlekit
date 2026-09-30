import Link from "next/link";
import { merchantApi, type PlatformFees } from "@/lib/merchant-api";
import { shortHash } from "@/lib/merchant-types";
import { PageHeader, Card, DataTable, EmptyState, ErrorBanner } from "@/components/ui";
import { NetworkBadge } from "@/components/NetworkBadge";

export const dynamic = "force-dynamic";

function amount(value: string | null): string {
  if (value === null) return "—";
  const n = Number(value);
  return Number.isNaN(n) ? value : n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export default async function PayoutsPage() {
  const [balances, profile, fees] = await Promise.all([merchantApi.balances(), merchantApi.profile(), merchantApi.fees()]);
  const names = new Map((profile.data?.networks ?? []).map((n) => [n.network as string, n.name]));
  const rows = balances.data ?? [];
  return (
    <>
      <PageHeader
        title="Balances"
        description="Buyers pay straight into your wallets, so there is nothing to withdraw: this is what each receiving address holds right now, read live from each chain."
      />
      <ErrorBanner error={balances.error} />
      <Card>
        <DataTable
          rows={rows}
          getKey={(b) => b.network}
          empty={
            <EmptyState
              title="No receiving addresses"
              message="Add the wallets you want to be paid into."
              action={
                <Link href="/settings" className="btn btn-primary">
                  Add addresses
                </Link>
              }
            />
          }
          columns={[
            {
              header: "Network",
              cell: (b) => (
                <span>
                  {names.get(b.network) ?? b.network} <NetworkBadge env={b.env} />
                </span>
              ),
            },
            {
              header: "Address",
              cell: (b) =>
                b.addressUrl ? (
                  <a className="link mono" href={b.addressUrl} target="_blank" rel="noreferrer">
                    {shortHash(b.address, 8, 6)}
                  </a>
                ) : (
                  <span className="mono">{shortHash(b.address, 8, 6)}</span>
                ),
            },
            { header: "Asset", cell: (b) => b.asset },
            {
              header: "Status",
              cell: (b) => (b.error ? <span className="field-error">Could not read: {b.error}</span> : <span className="dim">Live</span>),
            },
            { header: "Balance", align: "right", cell: (b) => `${amount(b.balance)} ${b.balance === null ? "" : b.asset}` },
          ]}
        />
      </Card>
      {fees.data?.configured ? <FeesCard fees={fees.data} /> : null}
      <p className="dim small">
        EVM balances are the stablecoin shown (USDC, USDG on Robinhood Chain, USDC.e on Tempo); HyperCore shows withdrawable
        USDC; Zcash shows transparent ZEC (mainnet only).
      </p>
    </>
  );
}

const STANDING_NOTE: Record<PlatformFees["standing"], string | null> = {
  good: null,
  due: "Your fee statement is ready. Pay it before the due date.",
  past_due: "Your fee statement is past due. Pay it to keep adding products.",
  restricted: "Your fee statement is overdue, so new products are limited to the free plan. Pay it to lift the limit.",
};

function FeesCard({ fees }: { fees: PlatformFees }) {
  const note = STANDING_NOTE[fees.standing];
  const pct = (fees.schedule.bps / 100).toString();
  return (
    <Card title="SettleKit fees">
      {note ? <div className="error-banner" role="status">{note}</div> : null}
      <p className="dim small">
        {pct}% per successful payment, billed once a month as one USDC statement. Since the last statement:{" "}
        {fees.accrued.paymentCount} payments, {amount(fees.accrued.grossVolume)} USDC volume, {amount(fees.accrued.fees)} USDC
        in fees.
      </p>
      <DataTable
        rows={fees.statements}
        getKey={(s) => s.id}
        empty={<EmptyState title="No statements yet" message="Your first statement arrives after the month you start selling." />}
        columns={[
          { header: "Period", cell: (s) => s.period ?? "-" },
          { header: "Payments", align: "right", cell: (s) => String(s.paymentCount) },
          { header: "Fees", align: "right", cell: (s) => `${amount(s.total)} ${s.currency}` },
          { header: "Due", cell: (s) => (s.dueAt ? s.dueAt.slice(0, 10) : "-") },
          { header: "Status", cell: (s) => s.status },
          {
            header: "",
            cell: (s) =>
              s.status === "open" && s.payUrl ? (
                <a className="btn btn-primary btn-small" href={s.payUrl} target="_blank" rel="noreferrer">
                  Pay
                </a>
              ) : s.payUrl ? (
                <a className="link" href={`${s.payUrl}/pdf`} target="_blank" rel="noreferrer">
                  Receipt
                </a>
              ) : null,
          },
        ]}
      />
    </Card>
  );
}
