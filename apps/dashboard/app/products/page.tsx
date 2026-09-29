import Link from "next/link";
import { merchantApi } from "@/lib/merchant-api";
import { paymentLinkUrl } from "@/lib/config";
import { formatDate } from "@/lib/format";
import { DELIVERY_OPTIONS, formatUsd } from "@/lib/merchant-types";
import { PageHeader, Card, DataTable, StatusBadge, EmptyState, ErrorBanner } from "@/components/ui";

export const dynamic = "force-dynamic";

const KIND_TITLE = new Map(DELIVERY_OPTIONS.map((o) => [o.kind as string, o.title]));
const INTERVAL: Record<string, string> = { monthly: " / month", yearly: " / year" };

export default async function ProductsPage() {
  const [products, profile] = await Promise.all([merchantApi.products(), merchantApi.profile()]);
  const networkName = new Map((profile.data?.networks ?? []).map((n) => [n.network as string, n.name]));
  return (
    <>
      <PageHeader
        title="Products"
        description="Everything you sell, its price, how access is delivered, and its reusable checkout link."
        action={
          <Link href="/products/new" className="btn btn-primary">
            New product
          </Link>
        }
      />
      <ErrorBanner error={products.error} />
      <Card>
        <DataTable
          rows={products.data ?? []}
          getKey={(p) => p.id}
          empty={
            <EmptyState
              title="No products yet"
              message="Create a product to get a checkout link you can share anywhere."
              action={
                <Link href="/products/new" className="btn btn-primary">
                  Create product
                </Link>
              }
            />
          }
          columns={[
            {
              header: "Product",
              cell: (p) => (
                <Link className="link" href={`/products/${p.id}`}>
                  {p.name}
                </Link>
              ),
            },
            { header: "Price", cell: (p) => (p.priceUsd ? `${formatUsd(p.priceUsd)}${INTERVAL[p.interval ?? ""] ?? ""}` : "—") },
            { header: "Delivery", cell: (p) => <span className="tag">{KIND_TITLE.get(p.deliveryKind) ?? "Custom"}</span> },
            {
              header: "Networks",
              cell: (p) =>
                p.acceptedNetworks === null ? (
                  <span className="dim">All accepted</span>
                ) : (
                  p.acceptedNetworks.map((n) => networkName.get(n) ?? n).join(", ")
                ),
            },
            { header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
            {
              header: "Link",
              cell: (p) =>
                p.slug && p.status === "active" ? (
                  <a className="link mono" href={paymentLinkUrl(p.slug)} target="_blank" rel="noreferrer">
                    /l/{p.slug}
                  </a>
                ) : (
                  <span className="dim">—</span>
                ),
            },
            { header: "Created", align: "right", cell: (p) => formatDate(p.createdAt) },
          ]}
        />
      </Card>
    </>
  );
}
