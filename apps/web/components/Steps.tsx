import { howItWorks } from "@/lib/content";

export function Steps() {
  return (
    <section className="section section-ruled section-bar">
      <div className="container">
        <div className="ref">
          <span className="ref-no">§ 02</span>
          <span>How a sale settles</span>
          <span className="ref-fill" aria-hidden="true" />
        </div>

        <div className="section-head">
          <h2 className="section-title">
            Create product, set price, get paid, deliver access
          </h2>
          <p className="section-desc">
            Four line items from idea to delivered access. SettleKit verifies the
            USDC payment and grants every deliverable automatically.
          </p>
        </div>

        <ol className="steps">
          {howItWorks.map((step) => (
            <li key={step.step} className="step">
              <span className="step-num">
                STEP {String(step.step).padStart(2, "0")}
              </span>
              <div>
                <h3 className="step-title">{step.title}</h3>
                <p className="step-desc">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
