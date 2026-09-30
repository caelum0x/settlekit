import { CHAINS, FOUNDER_STORY, HOW_IT_WORKS, ONBOARDING_URL, PRICING, feeLabel } from "@/lib/site";
import { links } from "@/lib/links";

function SectionRef({ no, label }: { no: string; label: string }) {
  return (
    <div className="ref">
      <span className="ref-no">§ {no}</span>
      <span>{label}</span>
      <span className="ref-fill" aria-hidden="true" />
    </div>
  );
}

export function FounderStory() {
  return (
    <section className="section section-ruled">
      <div className="container">
        <SectionRef no="01" label="Why this exists" />
        <div className="story">
          <h2 className="section-title">{FOUNDER_STORY.title}</h2>
          <div className="story-body">
            {FOUNDER_STORY.paragraphs.map((p) => (
              <p key={p.slice(0, 24)}>{p}</p>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function ChainGrid() {
  return (
    <section className="section section-ruled">
      <div className="container">
        <SectionRef no="02" label="Where buyers pay" />
        <div className="section-head">
          <h2 className="section-title">Eight chains, one checkout</h2>
          <p className="section-desc">
            Accept any mix. Every payment is verified on its own chain before access is delivered; a network without a
            verifier is never accepted. Labels say exactly what you receive.
          </p>
        </div>
        <div className="chain-grid">
          {CHAINS.map((chain) => (
            <article key={chain.name} className="chain-card">
              <div className="chain-head">
                <h3 className="chain-name">{chain.name}</h3>
                <span className="chain-asset">{chain.asset}</span>
              </div>
              {chain.label ? <span className="chain-label">{chain.label}</span> : null}
              <p className="chain-detail">{chain.detail}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HowItWorks() {
  return (
    <section className="section section-ruled section-bar">
      <div className="container">
        <SectionRef no="03" label="How it works" />
        <div className="section-head">
          <h2 className="section-title">Link, pay, receive, deliver</h2>
          <p className="section-desc">From a shared link to delivered access, with no platform holding your money in between.</p>
        </div>
        <ol className="steps">
          {HOW_IT_WORKS.map((step, i) => (
            <li key={step.title} className="step">
              <span className="step-num">STEP {String(i + 1).padStart(2, "0")}</span>
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

export function AgentPayments() {
  return (
    <section className="section section-ruled">
      <div className="container">
        <SectionRef no="04" label="AI agents are buyers too" />
        <div className="agent-grid">
          <div>
            <h2 className="section-title">Sell to AI agents over x402 and MPP</h2>
            <p className="section-desc">
              The same products can be bought by software. An agent calls your product endpoint, receives an HTTP 402
              price, pays in USDC on Solana, Base or another supported chain (x402) or on Tempo (MPP), and gets the
              delivered artifact in the response. Agent purchases show up in your dashboard, labelled, next to human
              ones.
            </p>
          </div>
          <pre className="agent-code" aria-label="Example agent purchase">
{`POST /v1/x402/products/prod_123/buy
<- 402 Payment Required
   accepts: USDC on solana, base, ...
-> retry with the signed USDC payment
<- 200 { payment, delivery: [license key] }`}
          </pre>
        </div>
      </div>
    </section>
  );
}

export function SimplePricing() {
  return (
    <section className="section section-ruled" id="pricing">
      <div className="container">
        <SectionRef no="05" label="Pricing" />
        <div className="pricing-simple">
          <div>
            <h2 className="section-title">Free to start. {feeLabel()} when you get paid.</h2>
            <p className="section-desc">
              No monthly fee, no setup fee, no reserve. You only pay a small fee on successful payments; network fees
              are paid by the buyer. Fees add up over the month and arrive as one USDC statement you pay from the
              dashboard. The core is open source if you would rather run it yourself.
            </p>
          </div>
          <ul className="pricing-points">
            <li>
              <b>${PRICING.monthlyUsd}</b> per month
            </li>
            <li>
              <b>{feeLabel()}</b> per successful payment
            </li>
            <li>
              <b>0</b> days waiting for payouts: funds land in your wallet
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

export function FinalCTA() {
  return (
    <section className="section section-ruled">
      <div className="container">
        <div className="cta">
          <div className="cta-copy">
            <div className="cta-eyebrow">Ready in minutes</div>
            <h2 className="cta-title">Paste your wallets, create a product, share the link.</h2>
            <p className="cta-desc">
              Guided setup takes three steps. Your first buyer can pay on any chain you accept the moment you finish.
            </p>
          </div>
          <div className="cta-actions">
            <a href={ONBOARDING_URL} className="btn btn-primary btn-lg">
              Start selling free
            </a>
            <a href={links.docs} className="btn btn-outline btn-lg">
              Read the docs
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
