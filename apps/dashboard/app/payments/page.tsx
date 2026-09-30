import Link from "next/link";
import { merchantApi } from "@/lib/merchant-api";
import { formatDateTime } from "@/lib/format";
import { formatUsd, shortHash } from "@/lib/merchant-types";
import { PageHeader, Card, DataTable, StatusBadge, EmptyState, ErrorBanner } from "@/components/ui";
import { NetworkChip, SourceTag } from "@/components/NetworkBadge";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: { status?: string; network?: string };
}

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "confirmed", label: "Paid" },
  { value: "pending", label: "Pending" },
  { value: "refunded", label: "Refunded" },
  { value: "failed", label: "Failed" },
];

export default async function PaymentsPage({ searchParams }: PageProps) {
  const status = searchParams.status ?? "";
  const network = searchParams.network ?? "";
  const [payments, profile] = await Promise.all([
    merchantApi.payments({ status, network }),
    merchantApi.profile(),
  ]);
  const accepted = (profile.data?.networks ?? []).filter((n) => n.accepted);
  const query = (next: { status?: string; network?: string }) => {
    const qs = new URLSearchParams(
      Object.entries({ status, network, ...next }).filter(([, v]) => v) as [string, string][],
    ).toString();
    return qs ? `/payments?${qs}` : "/payments";
  };

  return (
    <>
      <PageHeader title="Payments" description="Every payment on every network, verified on-chain before access is delivered." />
      <ErrorBanner error={payments.error} />
      <p className="dim small" style={{ marginBottom: 12 }}>
        Export for your books: <a className="link" href="/exports/payments">Payments CSV</a> ·{" "}
        <a className="link" href="/exports/xero">Xero bank statement</a> ·{" "}
        <a className="link" href="/exports/quickbooks">QuickBooks bank upload</a> ·{" "}
        <a className="link" href="/exports/ledger">Full ledger</a>
      </p>
      <div className="filter-bar">
        {STATUS_FILTERS.map((f) => (
          <Link key={f.value} href={query({ status: f.value })} className={`filter-pill${status === f.value ? " active" : ""}`}>
            {f.label}
          </Link>
        ))}
        <span className="filter-sep" />
        <Link href={query({ network: "" })} className={`filter-pill${network === "" ? " active" : ""}`}>
          All networks
        </Link>
        {accepted.map((n) => (
          <Link key={n.network} href={query({ network: n.network })} className={`filter-pill${network === n.network ? " active" : ""}`}>
            {n.name}
          </Link>
        ))}
      </div>
      <Card>
        <DataTable
          rows={payments.data ?? []}
          getKey={(p) => p.id}
          empty={<EmptyState title="No payments match" message="Payments appear here the moment a buyer pays and the transfer is verified." />}
          columns={[
            {
              header: "Product",
              cell: (p) => (
                <Link className="link" href={`/payments/${p.id}`}>
                  {p.products.map((x) => x.name).join(", ") || "Payment"}
                </Link>
              ),
            },
            { header: "Buyer", cell: (p) => p.buyer.email ?? (p.buyer.wallet ? <span className="mono">{shortHash(p.buyer.wallet)}</span> : <span className="dim">Unknown</span>) },
            { header: "Network", cell: (p) => <NetworkChip name={p.networkName} asset={p.asset} env={p.env} /> },
            {
              header: "Route",
              cell: (p) =>
                p.routedFrom ? (
                  <span className="tag" title={`Paid with ${p.routedFrom.originToken} on chain ${p.routedFrom.originChainId}`}>
                    via {p.routedFrom.provider}
                  </span>
                ) : (
                  <SourceTag source={p.source} />
                ),
            },
            { header: "Status", cell: (p) => <StatusBadge status={p.status === "confirmed" ? "paid" : p.status} /> },
            {
              header: "Transaction",
              cell: (p) =>
                p.txHash && p.explorerUrl ? (
                  <a className="link mono" href={p.explorerUrl} target="_blank" rel="noreferrer">
                    {shortHash(p.txHash)}
                  </a>
                ) : (
                  <span className="dim">—</span>
                ),
            },
            { header: "Date", cell: (p) => formatDateTime(p.confirmedAt ?? p.createdAt) },
            {
              header: "Amount",
              align: "right",
              cell: (p) => (p.settled ? `${formatUsd(p.amountUsd)} (${p.settled.amount} ${p.settled.asset})` : formatUsd(p.amountUsd)),
            },
          ]}
        />
      </Card>
    </>
  );
}
