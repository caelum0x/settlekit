import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/format";
import { PageHeader, Card, StatusBadge, ErrorBanner } from "@/components/ui";

export const dynamic = "force-dynamic";

const FLOW = ["open", "funded", "submitted", "approved"];

export default async function EscrowTaskDetailPage({
  params,
}: {
  params: { taskId: string };
}) {
  const { data: task, error } = await api.escrow.get(params.taskId);
  if (!task && !error) notFound();

  const currentStep = task ? FLOW.indexOf(task.status) : -1;

  return (
    <>
      <div className="breadcrumb">
        <Link href="/escrow/tasks">Escrow</Link> / {params.taskId}
      </div>
      <PageHeader
        title={task?.title ?? "Escrow Task"}
        description="Lifecycle: fund → submit → approve (or refund)."
        action={
          <Link href="/escrow/tasks" className="btn">
            ← Back
          </Link>
        }
      />
      <ErrorBanner error={error} />
      {task ? (
        <>
          <Card>
            <dl className="detail-grid">
              <dt>Task ID</dt>
              <dd className="mono">{task.id}</dd>
              <dt>Status</dt>
              <dd>
                <StatusBadge status={task.status} />
              </dd>
              <dt>Buyer</dt>
              <dd>{task.buyerEmail}</dd>
              <dt>Worker</dt>
              <dd>{task.workerEmail ?? "Unassigned"}</dd>
              <dt>Amount</dt>
              <dd>{formatMoney(task.amount)}</dd>
              <dt>Created</dt>
              <dd>{formatDate(task.createdAt)}</dd>
            </dl>
          </Card>
          <Card title="Progress">
            <div className="tag-list">
              {FLOW.map((step, i) => (
                <span
                  key={step}
                  className={`badge ${
                    task.status === "refunded"
                      ? "badge-bad"
                      : i <= currentStep
                        ? "badge-good"
                        : "badge-neutral"
                  }`}
                >
                  {step}
                </span>
              ))}
              {task.status === "refunded" ? (
                <span className="badge badge-bad">refunded</span>
              ) : null}
            </div>
          </Card>
        </>
      ) : (
        <Card>
          <p className="muted">
            Task <code>{params.taskId}</code> could not be loaded.
          </p>
        </Card>
      )}
    </>
  );
}
