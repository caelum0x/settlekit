import { merchantApi } from "@/lib/merchant-api";
import { formatDate, humanize } from "@/lib/format";
import { formatUsd, shortHash } from "@/lib/merchant-types";
import { PageHeader, Card, DataTable, StatusBadge, EmptyState, ErrorBanner } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const [customers, products] = await Promise.all([merchantApi.customers(), merchantApi.products()]);
  const productName = new Map((products.data ?? []).map((p) => [p.id, p.name]));
  return (
    <>
      <PageHeader title="Customers" description="Everyone who paid, what they spent, and the access they hold." />
      <ErrorBanner error={customers.error} />
      <Card>
        <DataTable
          rows={customers.data ?? []}
          getKey={(c) => c.id}
          empty={<EmptyState title="No customers yet" message="Buyers appear here after their first verified payment." />}
          columns={[
            {
              header: "Customer",
              cell: (c) => (
                <div>
                  <div>{c.email ?? (c.wallet ? <span className="mono">{shortHash(c.wallet)}</span> : <span className="dim">Anonymous</span>)}</div>
                  <div className="dim small">
                    {[c.githubUsername ? `GitHub @${c.githubUsername}` : null, c.discordUserId ? `Discord ${c.discordUserId}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
              ),
            },
            { header: "Networks", cell: (c) => c.networks.join(", ") || "—" },
            {
              header: "Access",
              cell: (c) =>
                c.entitlements.length === 0 ? (
                  <span className="dim">None</span>
                ) : (
                  <div className="tag-list">
                    {c.entitlements.map((e) => (
                      <span key={e.id} className="access-pill" title={humanize(e.entitlementType)}>
                        {productName.get(e.productId) ?? humanize(e.entitlementType)} <StatusBadge status={e.status} />
                      </span>
                    ))}
                  </div>
                ),
            },
            { header: "Payments", cell: (c) => String(c.payments) },
            { header: "Last paid", cell: (c) => formatDate(c.lastPaid) },
            { header: "Spent", align: "right", cell: (c) => formatUsd(c.spentUsd) },
          ]}
        />
      </Card>
    </>
  );
}
