// Activation funnel checklist shown on the dashboard home for new merchants.
// Server component: it just renders the tenant-scoped status the page fetched
// from GET /v1/onboarding. The page omits it entirely once `complete` is true,
// so an activated merchant never sees it.

import Link from "next/link";
import type { OnboardingStatus } from "@/lib/types";

export function OnboardingChecklist({ status }: { status: OnboardingStatus }) {
  return (
    <section className="card onboarding">
      <div className="onboarding-head">
        <div>
          <h2 className="card-title">Get set up</h2>
          <p className="muted">
            {status.completed} of {status.total} steps done — finish these to take your first USDC payment.
          </p>
        </div>
        <div className="onboarding-pct">{status.percent}%</div>
      </div>

      <div className="onboarding-progress" aria-hidden>
        <div className="onboarding-progress-fill" style={{ width: `${status.percent}%` }} />
      </div>

      <ol className="onboarding-steps">
        {status.steps.map((step) => {
          const isNext = !step.done && status.nextStep?.key === step.key;
          return (
            <li
              key={step.key}
              className={`onboarding-step${step.done ? " done" : ""}${isNext ? " next" : ""}`}
            >
              <span className="onboarding-check" aria-hidden>
                {step.done ? "✓" : "○"}
              </span>
              <span className="onboarding-step-body">
                <span className="onboarding-step-title">{step.title}</span>
                <span className="muted">{step.description}</span>
              </span>
              {step.done ? (
                <span className="onboarding-step-status muted">Done</span>
              ) : (
                <Link
                  href={step.href}
                  className={`btn ${isNext ? "btn-primary" : "btn-ghost"} btn-sm`}
                >
                  {isNext ? "Start" : "Open"}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
