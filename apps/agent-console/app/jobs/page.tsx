import {
  Card,
  DemoNotice,
  ErrorBanner,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
} from "@/components/ui";
import { SimpleCreateForm } from "@/components/forms/SimpleCreateForm";
import { AdvanceJobButton } from "@/components/AdvanceJobButton";
import { api } from "@/lib/api";
import {
  AMOUNT_USDC_RE,
  type JobRecord,
  type JobStatus,
} from "@/lib/agent-economy-types";
import {
  getJobLifecycleContext,
  type JobRow,
  type JobStep,
} from "@/lib/data";
import { formatUsdc, humanize, shortWallet } from "@/lib/format";

// Reads are never statically cached: router.refresh() after a create/advance
// must re-fetch the live list so the new/updated job appears immediately.
export const dynamic = "force-dynamic";

/**
 * Create a job through the real API (`POST /v1/jobs`). The org is implicit from
 * the authenticated key. amountUsdc is validated against the API's decimal regex
 * before POST so a bad value surfaces a clear message instead of a Zod 400.
 */
async function createJob(values: Record<string, string>): Promise<string | null> {
  "use server";
  const requester = (values.requester ?? "").trim();
  const worker = (values.worker ?? "").trim();
  const amountUsdc = (values.amountUsdc ?? "").trim();
  if (!requester) return "Requester wallet is required.";
  if (!worker) return "Worker wallet is required.";
  if (!AMOUNT_USDC_RE.test(amountUsdc)) {
    return "Amount must be a decimal with up to 6 decimal places (e.g. 120.00).";
  }
  const { error } = await api.jobs.create({ requester, worker, amountUsdc });
  return error;
}

/** Advance a job to its next forward lifecycle status (guarded by the API). */
async function advanceJob(jobId: string, to: JobStatus): Promise<string | null> {
  "use server";
  const { error } = await api.jobs.transition(jobId, to);
  return error;
}

/** Live job card: real JobRecord + an advance control. */
function LiveJobCard({ job }: { job: JobRecord }) {
  return (
    <Card title={`Job ${job.id}`}>
      <div className="row-between" style={{ marginBottom: 16 }}>
        <dl className="detail-grid">
          <dt>Requester</dt>
          <dd className="mono" title={job.requester}>
            {shortWallet(job.requester)}
          </dd>
          <dt>Worker</dt>
          <dd className="mono" title={job.worker}>
            {shortWallet(job.worker)}
          </dd>
          <dt>Escrow amount</dt>
          <dd className="mono" style={{ fontWeight: 600 }}>
            {formatUsdc(job.amountUsdc)}
          </dd>
          <dt>Status</dt>
          <dd>
            <StatusBadge status={job.status} />
          </dd>
          {job.deliverableUri ? (
            <>
              <dt>Deliverable</dt>
              <dd className="mono muted" title={job.deliverableUri}>
                {job.deliverableUri}
              </dd>
            </>
          ) : null}
        </dl>
      </div>
      <div className="step-label">Lifecycle</div>
      <AdvanceJobButton jobId={job.id} status={job.status} action={advanceJob} />
    </Card>
  );
}

function LiveJobs({ jobs }: { jobs: JobRecord[] }) {
  const settled = jobs.filter((j) => j.status === "settled").length;
  const terminal = new Set<JobStatus>(["settled", "refunded", "cancelled"]);
  const inFlight = jobs.filter((j) => !terminal.has(j.status)).length;
  const totalEscrowed = jobs.reduce((acc, j) => acc + Number(j.amountUsdc || 0), 0);

  return (
    <>
      <StatGrid>
        <StatCard label="Jobs total" value={String(jobs.length)} />
        <StatCard
          label="Settled"
          value={String(settled)}
          tone={jobs.length > 0 && settled === jobs.length ? "good" : "warn"}
        />
        <StatCard
          label="In flight"
          value={String(inFlight)}
          tone={inFlight > 0 ? "warn" : "default"}
        />
        <StatCard
          label="Total escrowed"
          value={formatUsdc(String(totalEscrowed))}
        />
      </StatGrid>

      {jobs.map((job) => (
        <LiveJobCard key={job.id} job={job} />
      ))}
    </>
  );
}

/* ---- Demo (offline LocalPort) rendering ---- */

function stepLabel(step: JobStep): string {
  if (step.transition === "create") return "Create job";
  if (step.transition === "evaluate_pass") return "Evaluate (passed)";
  if (step.transition === "evaluate_fail") return "Evaluate (failed)";
  return humanize(step.transition);
}

function JobTimeline({ steps }: { steps: JobStep[] }) {
  return (
    <ol className="onboarding-steps">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const stateClass = isLast ? "next" : "done";
        return (
          <li key={`${step.transition}-${step.txHash}`} className={`onboarding-step ${stateClass}`}>
            <span className="onboarding-check">{isLast ? "•" : "✓"}</span>
            <div className="onboarding-step-body">
              <span className="onboarding-step-title">{stepLabel(step)}</span>
              <span className="mono muted" title={step.txHash}>
                {step.txHash}
              </span>
            </div>
            <span className="onboarding-step-status">
              <StatusBadge status={step.status} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function DemoJobCard({ job }: { job: JobRow }) {
  return (
    <Card title={`Job ${job.id}`}>
      <div className="row-between" style={{ marginBottom: 16 }}>
        <dl className="detail-grid">
          <dt>Requester</dt>
          <dd className="mono" title={job.requester}>
            {shortWallet(job.requester)}
          </dd>
          <dt>Worker</dt>
          <dd className="mono" title={job.worker}>
            {shortWallet(job.worker)}
          </dd>
          <dt>Escrow amount</dt>
          <dd className="mono" style={{ fontWeight: 600 }}>
            {formatUsdc(job.amount.amount)}
          </dd>
          <dt>Status</dt>
          <dd>
            <StatusBadge status={job.status} />
          </dd>
        </dl>
      </div>
      <div className="step-label">Lifecycle</div>
      <JobTimeline steps={job.steps} />
    </Card>
  );
}

async function DemoJobs() {
  const { totals, jobs } = await getJobLifecycleContext();
  return (
    <>
      <StatGrid>
        <StatCard label="Jobs total" value={String(totals.jobsTotal)} />
        <StatCard
          label="Settled"
          value={String(totals.settled)}
          tone={totals.settled === totals.jobsTotal ? "good" : "warn"}
        />
        <StatCard
          label="In flight"
          value={String(totals.inFlight)}
          tone={totals.inFlight > 0 ? "warn" : "default"}
        />
        <StatCard
          label="Total escrowed"
          value={formatUsdc(totals.totalEscrowed.amount)}
        />
      </StatGrid>

      {jobs.map((job) => (
        <DemoJobCard key={job.id} job={job} />
      ))}
    </>
  );
}

export default async function JobsPage() {
  const result = await api.jobs.list();
  const live = !result.error && result.data.length > 0;

  return (
    <>
      <PageHeader
        title="Jobs"
        description="ERC-8183 autonomous-agent job lifecycle. A requester funds a USDC escrow, a worker submits a deliverable, an evaluator scores it, and the escrow settles to the worker — each step a guarded transition."
      />

      {live ? null : <ErrorBanner error={result.error} />}
      {live ? null : <DemoNotice />}

      {live ? <LiveJobs jobs={result.data} /> : <DemoJobs />}

      <Card title="Create a job">
        <p className="muted">
          Create a job in the SettleKit registry. It starts in the{" "}
          <code>created</code> state; use the Advance control on each job card to
          move it forward (created → funded → submitted → evaluated → settled).
        </p>
        <SimpleCreateForm
          submitLabel="Create job"
          successMessage="Job created."
          action={createJob}
          fields={[
            {
              name: "requester",
              label: "Requester wallet",
              required: true,
              placeholder: "0x…",
            },
            {
              name: "worker",
              label: "Worker wallet",
              required: true,
              placeholder: "0x…",
            },
            {
              name: "amountUsdc",
              label: "Escrow amount (USDC)",
              required: true,
              placeholder: "120.00",
              hint: "Decimal with up to 6 decimal places.",
            },
          ]}
        />
      </Card>
    </>
  );
}
