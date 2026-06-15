import { CustomerEntryForm } from "@/components/CustomerEntryForm";

const FEATURES = [
  {
    title: "Your access",
    body: "Entitlements for repos, SaaS features, APIs, files, and Discord — all in one place.",
  },
  {
    title: "Subscriptions",
    body: "See plan, status, current period, and renewal or grace windows.",
  },
  {
    title: "Keys",
    body: "License keys with machine limits and API keys with scopes and last-used.",
  },
  {
    title: "Receipts",
    body: "Every USDC payment with amount, date, status, and on-chain transaction.",
  },
];

export default function LandingPage() {
  return (
    <div>
      <section className="hero">
        <h1>Your SettleKit portal</h1>
        <p className="hero-lede">
          Everything you bought, in one place. Manage access, subscriptions,
          license keys, API keys, downloads, and view receipts for every payment
          settled in USDC.
        </p>
      </section>

      <div className="feature-grid">
        {FEATURES.map((f) => (
          <div className="feature" key={f.title}>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </div>
        ))}
      </div>

      <section className="entry-card">
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Open your portal</h2>
        <p className="hero-lede" style={{ fontSize: "0.92rem", marginBottom: 14 }}>
          Enter the customer id from your receipt or welcome email to view your
          account.
        </p>
        <CustomerEntryForm />
        <p className="entry-note">
          In production this step is a magic-link sign-in. Today the portal
          resolves a customer directly by id through the SettleKit API.
        </p>
      </section>
    </div>
  );
}
