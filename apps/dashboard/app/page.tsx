import Link from "next/link";
import { merchantApi } from "@/lib/merchant-api";
import { formatDateTime } from "@/lib/format";
import { formatUsd } from "@/lib/merchant-types";
import { PageHeader, StatGrid, StatCard, Card, DataTable, StatusBadge, EmptyState, ErrorBanner } from "@/components/ui";
import { NetworkChip, SourceTag } from "@/components/NetworkBadge";
import { ShareLink } from "@/components/ShareLink";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [overview, payments, profile] = await Promise.all([
    merchantApi.overview(),
    merchantApi.payments(),
    merchantApi.profile(),
  ]);
  const o = overview.data;
  const recent = (payments.data ?? []).slice(0, 8);
  const networkName = new Map((profile.data?.networks ?? []).map((n) => [n.network as string, n.name]));
  const byNetwork = Object.entries(o?.byNetwork ?? {}).sort((a, b) => b[1].volumeUsd - a[1].volumeUsd);

  return (
    <>
      <PageHeader
        title="Home"
        description="Payments across every network you accept, and the links that bring them in."
        action={
          <Link href="/products/new" className="btn btn-primary">
            New product
          </Link>
        }
      />
      <ErrorBanner error={overview.error} />

      {o && (!o.onboarded || o.productCount === 0) ? (
        <section className="card callout">
          <h2 className="card-title">Finish setting up</h2>
          <p className="page-desc">
            {o.onboarded
              ? "Create your first product to get a checkout link."
              : "Add the wallets you want to be paid into, then create your first product."}
          </p>
          <div className="builder-actions" style={{ justifyContent: "flex-start" }}>
            <Link href="/onboarding" className="btn btn-primary">
              Continue setup
            </Link>
          </div>
        </section>
      ) : null}

      <StatGrid>
        <StatCard label="Volume" value={formatUsd(o?.volumeUsd ?? 0)} hint="Confirmed payments" tone="good" />
        <StatCard label="Payments" value={String(o?.paymentCount ?? 0)} hint="Verified on-chain" />
        <StatCard label="Products" value={String(o?.productCount ?? 0)} hint="With reusable links" />
        <StatCard label="Networks" value={String(o?.acceptedNetworks.length ?? 0)} hint="Accepted" />
      </StatGrid>

      {o?.firstProduct?.slug ? (
        <Card title={`Checkout link: ${o.firstProduct.name}`}>
          <ShareLink slug={o.firstProduct.slug} productName={o.firstProduct.name} priceUsd={o.firstProduct.priceUsd} showEmbed={false} />
        </Card>
      ) : null}

      {byNetwork.length > 0 ? (
        <Card title="Volume by network">
          <div className="bar-list">
            {byNetwork.map(([network, v]) => {
              const max = byNetwork[0]![1].volumeUsd || 1;
              return (
                <div className="bar-row" key={network}>
                  <span className="bar-label">{networkName.get(network) ?? network}</span>
                  <span className="bar-track">
                    <span className="bar-fill" style={{ width: `${Math.max(3, (v.volumeUsd / max) * 100)}%` }} />
                  </span>
                  <span className="bar-value">
                    {formatUsd(v.volumeUsd)} · {v.count}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      <Card title="Recent payments">
        <DataTable
          rows={recent}
          getKey={(p) => p.id}
          empty={<EmptyState title="No payments yet" message="Share your checkout link; payments show up here as soon as they are verified." />}
          columns={[
            { header: "Product", cell: (p) => <Link className="link" href={`/payments/${p.id}`}>{p.products.map((x) => x.name).join(", ") || "Payment"}</Link> },
            { header: "Network", cell: (p) => <NetworkChip name={p.networkName} asset={p.asset} env={p.env} /> },
            { header: "Source", cell: (p) => <SourceTag source={p.source} /> },
            { header: "Status", cell: (p) => <StatusBadge status={p.status === "confirmed" ? "paid" : p.status} /> },
            { header: "Date", cell: (p) => formatDateTime(p.confirmedAt ?? p.createdAt) },
            { header: "Amount", align: "right", cell: (p) => formatUsd(p.amountUsd) },
          ]}
        />
      </Card>
    </>
  );
}
