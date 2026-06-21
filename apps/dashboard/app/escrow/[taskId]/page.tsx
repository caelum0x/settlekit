import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
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

  const id = params.taskId;
  const revalidate = (): void => revalidatePath(`/escrow/${id}`);

  async function assignAction(form: FormData): Promise<void> {
    "use server";
    await api.escrow.assign(id, String(form.get("workerCustomerId") ?? ""));
    revalidate();
  }
  async function fundAction(form: FormData): Promise<void> {
    "use server";
    await api.escrow.fund(id, String(form.get("fundingTxHash") ?? ""));
    revalidate();
  }
  async function submitAction(form: FormData): Promise<void> {
    "use server";
    await api.escrow.submit(id, String(form.get("content") ?? ""));
    revalidate();
  }
  async function approveAction(): Promise<void> {
    "use server";
    await api.escrow.approve(id);
    revalidate();
  }
  async function refundAction(form: FormData): Promise<void> {
    "use server";
    await api.escrow.refund(id, String(form.get("reason") ?? ""));
    revalidate();
  }

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
          {task.status !== "approved" && task.status !== "refunded" ? (
            <Card title="Actions">
              <div className="form" style={{ gap: "0.75rem" }}>
                {task.status === "open" ? (
                  <>
                    <form action={assignAction} className="row-between" style={{ gap: "0.5rem" }}>
                      <input className="input" name="workerCustomerId" placeholder="Worker customer id (cus_…)" required />
                      <button className="btn" type="submit">Assign worker</button>
                    </form>
                    <form action={fundAction} className="row-between" style={{ gap: "0.5rem" }}>
                      <input className="input" name="fundingTxHash" placeholder="Funding tx hash (0x…)" required />
                      <button className="btn btn-primary" type="submit">Fund</button>
                    </form>
                  </>
                ) : null}
                {task.status === "funded" ? (
                  <form action={submitAction} className="row-between" style={{ gap: "0.5rem" }}>
                    <input className="input" name="content" placeholder="Deliverable / submission notes" required />
                    <button className="btn btn-primary" type="submit">Submit work</button>
                  </form>
                ) : null}
                {task.status === "submitted" ? (
                  <form action={approveAction}>
                    <button className="btn btn-primary" type="submit">Approve &amp; release</button>
                  </form>
                ) : null}
                {task.status === "funded" || task.status === "submitted" ? (
                  <form action={refundAction} className="row-between" style={{ gap: "0.5rem" }}>
                    <input className="input" name="reason" placeholder="Refund reason" required />
                    <button className="btn" type="submit">Refund</button>
                  </form>
                ) : null}
              </div>
            </Card>
          ) : null}
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
