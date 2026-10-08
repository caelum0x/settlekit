import { links } from "@/lib/links";
import { ONBOARDING_URL, feeLabel } from "@/lib/site";

// One product, paid from four different chains: every line settles in the
// seller's stablecoin and access is delivered on verification.
const statementRows = [
  { no: "01", desc: "Pro templates", meta: "Solana · USDC", credit: "49.00" },
  { no: "02", desc: "Pro templates", meta: "Base · USDC", credit: "49.00" },
  { no: "03", desc: "Pro templates", meta: "paid in ETH, routed to Arbitrum USDC", credit: "49.00" },
  { no: "04", desc: "Pro templates", meta: "AI agent · x402 on Base", credit: "49.00" },
  { no: "05", desc: "Pro templates", meta: "Tempo · USDC.e", credit: "49.00" },
] as const;

export function Hero() {
  return (
    <section className="hero">
      <div className="container hero-grid">
        <div className="hero-copy">
          <span className="hero-eyebrow">USDC checkout for merchants</span>
          <h1 className="hero-title">
            Accept USDC payments
            <br />
            with <em>no card fees</em>.
          </h1>
          <p className="hero-subhead">
            Card processors keep about 3% plus 30 cents of every sale, hold payouts and can freeze your account. With
            SettleKit, buyers pay in USDC (or any token) on Solana, Base, Ethereum, Arbitrum and more, and the money lands
            in your own wallet. On-chain payments are final, so there are no chargebacks. GitHub access, license keys,
            downloads and Discord roles are delivered automatically.
          </p>

          <div className="hero-actions">
            <a href={ONBOARDING_URL} className="btn btn-primary btn-lg">
              Create a free merchant account
            </a>
            <a href="/proof" className="btn btn-outline btn-lg">
              See live payments
            </a>
          </div>

          <p className="hero-subnote">
            No monthly fee, {feeLabel()} per successful payment. Open source; self-host any time.{" "}
            <a className="text-link" href={links.docs}>
              Read the docs
            </a>
            .
          </p>
        </div>

        <div
          className="statement"
          role="img"
          aria-label="Example statement: one product paid on Solana, Base, Arbitrum via routing, by an AI agent over x402, and on Tempo; each line lands as stablecoins in the seller's wallet and access is delivered."
        >
          <div className="statement-head">
            <div>
              <div className="statement-title">Settlement statement</div>
              <div className="statement-sub">Paid straight to your wallets</div>
            </div>
            <div className="statement-ref">
              LINK
              <b>/l/pro-templates</b>
            </div>
          </div>

          <div className="statement-cols" aria-hidden="true">
            <span>#</span>
            <span>Payment</span>
            <span style={{ textAlign: "right" }}>Fee</span>
            <span style={{ textAlign: "right" }}>Received</span>
          </div>

          <ol className="statement-rows">
            {statementRows.map((row, i) => (
              <li key={row.no} className="statement-row" style={{ animationDelay: `${0.25 + i * 0.32}s` }}>
                <span className="statement-row-no">{row.no}</span>
                <span className="statement-row-desc">
                  {row.desc} <small>{row.meta}</small>
                </span>
                <span className="statement-debit" />
                <span className="statement-credit">+{row.credit}</span>
              </li>
            ))}
          </ol>

          <div className="statement-foot">
            <span className="statement-settled">Received</span>
            <span className="statement-total">$245.00 in stablecoins</span>
          </div>

          <div className="statement-delivered">
            <b>Access delivered:</b> 5 GitHub repo invites, automatically
          </div>

          <span className="stamp" aria-hidden="true">
            Settled
          </span>
        </div>
      </div>
    </section>
  );
}
