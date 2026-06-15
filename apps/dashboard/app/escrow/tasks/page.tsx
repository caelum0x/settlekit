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
import { SimpleCreateForm } from "@/components/forms/SimpleCreateForm";

export const dynamic = "force-dynamic";

async function createTask(values: Record<string, string>): Promise<string | null> {
  "use server";
  const amount = Math.round((parseFloat(values.amount || "0") || 0) * 1_000_000);
  const { error } = await api.escrow.create(
    values.title ?? "",
    values.buyerEmail ?? "",
    amount,
  );
  return error;
}

export default async function EscrowTasksPage() {
  const tasks = await api.escrow.tasks();
  return (
    <>
      <PageHeader
        title="Escrow Tasks"
        description="Fund, submit, and approve work for agents and freelancers — released on approval."
      />
      <ErrorBanner error={tasks.error} />
      <Card title="Tasks">
        <DataTable
          rows={tasks.data}
          getKey={(t) => t.id}
          empty={
            <EmptyState
              title="No escrow tasks yet"
              message="Create a task, fund it, and release payment when the deliverable is approved."
            />
          }
          columns={[
            {
              header: "Title",
              cell: (t) => (
                <Link href={`/escrow/${t.id}`} className="mono">
                  {t.title}
                </Link>
              ),
            },
            { header: "Buyer", cell: (t) => t.buyerEmail },
            { header: "Worker", cell: (t) => t.workerEmail ?? "Unassigned" },
            { header: "Status", cell: (t) => <StatusBadge status={t.status} /> },
            { header: "Created", cell: (t) => formatDate(t.createdAt) },
            { header: "Amount", align: "right", cell: (t) => formatMoney(t.amount) },
          ]}
        />
      </Card>
      <Card title="Create escrow task">
        <SimpleCreateForm
          submitLabel="Create task"
          successMessage="Escrow task created."
          action={createTask}
          fields={[
            { name: "title", label: "Task title", required: true, placeholder: "Build landing page" },
            { name: "buyerEmail", label: "Buyer email", type: "email", required: true },
            { name: "amount", label: "Amount (USDC)", type: "number", required: true, placeholder: "500.00" },
          ]}
        />
      </Card>
    </>
  );
}
