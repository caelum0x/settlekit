import {
  Card,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
} from "@/components/ui";
import { getJobLifecycleContext, type JobRow, type JobStep } from "@/lib/data";
import { formatUsdc, humanize, shortWallet } from "@/lib/format";

/** Human label for a lifecycle transition step. */
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
        // Completed steps render "done"; the final terminal step is highlighted.
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

function JobCard({ job }: { job: JobRow }) {
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

export default async function JobsPage() {
  const { totals, jobs } = await getJobLifecycleContext();

  return (
    <>
      <PageHeader
        title="Jobs"
        description="ERC-8183 autonomous-agent job lifecycle. A requester funds a USDC escrow, a worker submits a deliverable, an evaluator scores it, and the escrow settles to the worker — each step a real on-chain transition."
      />

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
        <JobCard key={job.id} job={job} />
      ))}
    </>
  );
}
