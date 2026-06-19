import { hero, trustStrip } from "@/lib/content";
import { links, internalLinks } from "@/lib/links";

// A single settled sale, rendered as a real statement. Debit = money out
// (fees, splits, payout); credit = the gross sale landing. It nets to the
// seller payout — conserved to the cent, which is the whole point of SettleKit.
const statementRows = [
  { no: "01", desc: "Sale · private repo", meta: "atlas-starter", credit: "50.00" },
  { no: "02", desc: "USDC settlement", meta: "Circle Gateway", credit: "—" },
  { no: "03", desc: "Platform fee", meta: "0.50%", debit: "0.25" },
  { no: "04", desc: "Maintainer split", meta: "30 payees", debit: "2.50" },
  { no: "05", desc: "Payout · seller wallet", meta: "0x9f…41c", debit: "47.25" },
] as const;

export function Hero() {
  return (
    <section className="hero">
      <div className="container hero-grid">
        <div className="hero-copy">
          <span className="hero-eyebrow">{hero.eyebrow}</span>
          <h1 className="hero-title">
            Sell software.
            <br />
            <em>Settle</em> in USDC.
            <br />
            Deliver access.
          </h1>
          <p className="hero-subhead">{hero.subhead}</p>

          <div className="hero-actions">
            <a href={links.dashboard} className="btn btn-primary btn-lg">
              Open the dashboard
            </a>
            <a href={links.docs} className="btn btn-outline btn-lg">
              Read the docs
            </a>
          </div>

          <p className="hero-subnote">
            Already selling?{" "}
            <a className="text-link" href={internalLinks.useCases}>
              See the five ways developers use SettleKit
            </a>
            .
          </p>

          <div className="trust-strip" aria-label="Built on">
            {trustStrip.map((item) => (
              <span key={item} className="trust-item">
                {item}
              </span>
            ))}
          </div>
        </div>

        <div
          className="statement"
          role="img"
          aria-label="Example SettleKit settlement statement: a 50.00 USDC repo sale settles, fees and a 30-payee maintainer split are deducted, the seller payout is recorded, and access is delivered."
        >
          <div className="statement-head">
            <div>
              <div className="statement-title">Settlement Statement</div>
              <div className="statement-sub">SettleKit · USDC ledger</div>
            </div>
            <div className="statement-ref">
              REF
              <b>SK-0001</b>
            </div>
          </div>

          <div className="statement-cols" aria-hidden="true">
            <span>#</span>
            <span>Description</span>
            <span style={{ textAlign: "right" }}>Debit</span>
            <span style={{ textAlign: "right" }}>Credit</span>
          </div>

          <ol className="statement-rows">
            {statementRows.map((row, i) => (
              <li
                key={row.no}
                className="statement-row"
                style={{ animationDelay: `${0.25 + i * 0.32}s` }}
              >
                <span className="statement-row-no">{row.no}</span>
                <span className="statement-row-desc">
                  {row.desc} <small>{row.meta}</small>
                </span>
                <span className="statement-debit">
                  {"debit" in row && row.debit ? `-${row.debit}` : ""}
                </span>
                <span className="statement-credit">
                  {"credit" in row && row.credit && row.credit !== "—"
                    ? `+${row.credit}`
                    : ""}
                </span>
              </li>
            ))}
          </ol>

          <div className="statement-foot">
            <span className="statement-settled">Net settled</span>
            <span className="statement-total">$50.00 USDC</span>
          </div>

          <div className="statement-delivered">
            <b>Access delivered:</b> repo collaborator · license key · Discord role
          </div>

          <span className="stamp" aria-hidden="true">
            Settled
          </span>
        </div>
      </div>
    </section>
  );
}
