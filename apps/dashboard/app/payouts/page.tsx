import Link from "next/link";
import { merchantApi } from "@/lib/merchant-api";
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
  const [balances, profile] = await Promise.all([merchantApi.balances(), merchantApi.profile()]);
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
      <p className="dim small">
        EVM balances are the stablecoin shown (USDC, USDG on Robinhood Chain, USDC.e on Tempo); HyperCore shows withdrawable
        USDC; Zcash shows transparent ZEC (mainnet only).
      </p>
    </>
  );
}
