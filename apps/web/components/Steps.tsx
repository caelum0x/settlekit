import { howItWorks } from "@/lib/content";

export function Steps() {
  return (
    <section className="section section-muted">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow">How it works</span>
          <h2 className="section-title">
            Create product → Set price → Buyer pays → Access delivered
          </h2>
          <p className="section-desc">
            From an idea to delivered access in four steps. SettleKit verifies the
            USDC payment and grants every deliverable automatically.
          </p>
        </div>

        <ol className="steps">
          {howItWorks.map((step) => (
            <li key={step.step} className="step">
              <span className="step-num">{step.step}</span>
              <h3 className="step-title">{step.title}</h3>
              <p className="step-desc">{step.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
