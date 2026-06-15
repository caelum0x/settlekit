import Link from "next/link";
import { api } from "@/lib/api";
import { formatMoney, formatDate, humanize } from "@/lib/format";
import {
  PageHeader,
  Card,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const products = await api.products.list();

  return (
    <>
      <PageHeader
        title="Products"
        description="Everything you sell — SaaS plans, repos, APIs, downloads, license keys, and more."
        action={
          <Link href="/products/new" className="btn btn-primary">
            + Create Product
          </Link>
        }
      />
      <ErrorBanner error={products.error} />
      <Card>
        <DataTable
          rows={products.data}
          getKey={(p) => p.id}
          empty={
            <EmptyState
              title="No products yet"
              message="Use the Product Builder to choose what to sell, how to charge, and what happens after payment."
              action={
                <Link href="/products/new" className="btn btn-primary">
                  Launch Product Builder
                </Link>
              }
            />
          }
          columns={[
            {
              header: "Name",
              cell: (p) => (
                <Link href={`/products/${p.id}`} className="mono">
                  {p.name}
                </Link>
              ),
            },
            { header: "Sells", cell: (p) => humanize(p.sellType) },
            { header: "Charge", cell: (p) => humanize(p.chargeModel) },
            { header: "Delivery", cell: (p) => humanize(p.deliveryAction) },
            { header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
            { header: "Created", cell: (p) => formatDate(p.createdAt) },
            {
              header: "Price",
              align: "right",
              cell: (p) => formatMoney(p.price),
            },
          ]}
        />
      </Card>
    </>
  );
}
