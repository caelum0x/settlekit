import { api } from "@/lib/api";
import { formatMoney, formatDate, formatNumber } from "@/lib/format";
import {
  PageHeader,
  Card,
  DataTable,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const customers = await api.customers.list();
  return (
    <>
      <PageHeader
        title="Customers"
        description="People and agents who have purchased access to your products."
      />
      <ErrorBanner error={customers.error} />
      <Card>
        <DataTable
          rows={customers.data}
          getKey={(c) => c.id}
          empty={
            <EmptyState
              title="No customers yet"
              message="Buyers are created automatically on first purchase and tracked here."
            />
          }
          columns={[
            { header: "Email", cell: (c) => c.email },
            { header: "Name", cell: (c) => c.name ?? "—" },
            {
              header: "Active access",
              cell: (c) => formatNumber(c.activeEntitlements),
            },
            { header: "Since", cell: (c) => formatDate(c.createdAt) },
            {
              header: "Lifetime value",
              align: "right",
              cell: (c) => formatMoney(c.lifetimeValue),
            },
          ]}
        />
      </Card>
    </>
  );
}
