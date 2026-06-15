import type { Metadata } from "next";
import { useCases } from "@/lib/content";
import { CTA } from "@/components/CTA";
import { links } from "@/lib/links";

export const metadata: Metadata = {
  title: "Use cases — SettleKit",
  description:
    "Five ways developers use SettleKit: sell a private repo, add USDC billing to a SaaS, monetize an API, sell a developer bundle, and let AI agents buy your service.",
};

export default function UseCasesPage() {
  return (
    <>
      <section className="section page-hero">
        <div className="container section-head">
          <span className="eyebrow">Use cases</span>
          <h1 className="section-title">Five ways developers sell with SettleKit</h1>
          <p className="section-desc">
            From a private repo to autonomous agent payments — each flow is built
            in, settled in USDC, and delivers access automatically.
          </p>
        </div>
      </section>

      <section className="section section-tight">
        <div className="container">
          <div className="usecase-list">
            {useCases.map((useCase, index) => (
              <article key={useCase.id} className="usecase-card" id={useCase.id}>
                <span className="usecase-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="usecase-body">
                  <h2 className="usecase-title">{useCase.title}</h2>
                  <p className="usecase-promise">{useCase.promise}</p>
                  <p className="usecase-detail">{useCase.detail}</p>
                  <div className="usecase-target">
                    <span className="usecase-target-label">Who it's for</span>
                    <span className="usecase-target-value">{useCase.target}</span>
                  </div>
                  <div className="usecase-links">
                    <a href={links.dashboard} className="text-link">
                      Start in the dashboard →
                    </a>
                    <a href={links.docs} className="text-link">
                      Read the guide →
                    </a>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <CTA
        title="Find your fastest path to revenue"
        description="Whichever way you sell, SettleKit handles payment verification and access delivery so you can ship the product, not the billing."
      />
    </>
  );
}
