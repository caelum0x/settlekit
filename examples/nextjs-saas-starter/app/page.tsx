import Link from "next/link";
import { CustomerIdInput } from "../components/CustomerIdInput";
import { GatedExport } from "../components/GatedExport";

export default function HomePage() {
  return (
    <main className="container">
      <section className="hero">
        <h1>AI Export Pro</h1>
        <p className="lead">
          Turn messy notes, reports and spreadsheets into polished,
          presentation-ready exports. The AI Export action is a premium feature —
          gated behind a SettleKit <code>ai_export</code> entitlement.
        </p>
      </section>

      <section className="tiers">
        <div className="card">
          <h3>Free</h3>
          <div className="price">
            $0 <small>/ forever</small>
          </div>
          <ul className="features">
            <li>Manual CSV export</li>
            <li>Up to 3 documents</li>
            <li>Community support</li>
          </ul>
        </div>

        <div className="card card--pro">
          <h3>Pro</h3>
          <div className="price">
            $29 <small>/ month</small>
          </div>
          <ul className="features">
            <li>AI Export (the gated feature)</li>
            <li>PDF, CSV and Notion targets</li>
            <li>Unlimited documents</li>
            <li>Priority support</li>
          </ul>
        </div>
      </section>

      <h2>Try the gated feature</h2>
      <p className="muted">
        Enter any customer id below. SettleKit verifies the entitlement live via
        the API — entitled customers get the export tool, everyone else gets the
        paywall.
      </p>

      <CustomerIdInput />
      <GatedExport />

      <p className="muted" style={{ marginTop: 16 }}>
        Prefer a dedicated screen?{" "}
        <Link href="/export">Open the Export page →</Link>
      </p>
    </main>
  );
}
