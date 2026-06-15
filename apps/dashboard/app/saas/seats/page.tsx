import { api } from "@/lib/api";
import {
  PageHeader,
  SubNav,
  Card,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";
import { SAAS_NAV } from "../nav";

export const dynamic = "force-dynamic";

export default async function SaasSeatsPage() {
  const seats = await api.saas.seats();
  return (
    <>
      <PageHeader
        title="Seats"
        description="Per-seat assignments for team plans."
      />
      <SubNav items={SAAS_NAV} />
      <ErrorBanner error={seats.error} />
      <Card>
        <DataTable
          rows={seats.data}
          getKey={(s) => s.id}
          empty={
            <EmptyState
              title="No seats provisioned"
              message="Seat-based plans allocate seats here; assign them to team members."
            />
          }
          columns={[
            { header: "Plan", cell: (s) => s.planName },
            { header: "Assigned to", cell: (s) => s.assignedTo ?? "—" },
            { header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
          ]}
        />
      </Card>
    </>
  );
}
