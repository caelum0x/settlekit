import Link from "next/link";
import { api } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/format";
import {
  PageHeader,
  Card,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function BundlesPage() {
  const bundles = await api.bundles.list();
  return (
    <>
      <PageHeader
        title="Bundles"
        description="Combine products into one purchase — buyers get every included delivery action at once."
        action={
          <Link href="/bundles/new" className="btn btn-primary">
            + New Bundle
          </Link>
        }
      />
      <ErrorBanner error={bundles.error} />
      <Card>
        <DataTable
          rows={bundles.data}
          getKey={(b) => b.id}
          empty={
            <EmptyState
              title="No bundles yet"
              message="Bundle a repo + license key + Discord role into a single offer."
              action={
                <Link href="/bundles/new" className="btn btn-primary">
                  Create bundle
                </Link>
              }
            />
          }
          columns={[
            {
              header: "Name",
              cell: (b) => (
                <Link href={`/bundles/${b.id}`} className="mono">
                  {b.name}
                </Link>
              ),
            },
            { header: "Products", cell: (b) => String(b.productIds.length) },
            { header: "Status", cell: (b) => <StatusBadge status={b.status} /> },
            { header: "Created", cell: (b) => formatDate(b.createdAt) },
            { header: "Price", align: "right", cell: (b) => formatMoney(b.price) },
          ]}
        />
      </Card>
    </>
  );
}
