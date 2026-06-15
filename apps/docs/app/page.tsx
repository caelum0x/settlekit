/**
 * Overview / landing page (plan §34).
 *
 * Frames what SettleKit is, the use cases it serves, how the buy-flow works, and
 * links into the guides. Code samples reference the real package surfaces so the
 * landing copy and the SDK never drift apart.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { CodeBlock } from "../components/CodeBlock";
import { NAV } from "../lib/nav";

export const metadata: Metadata = {
  title: "Overview",
  description:
    "Sell software, APIs, and private repos in USDC. SettleKit handles payment verification, access delivery, subscriptions, license keys, webhooks, and customer portals.",
};

const USE_CASES = [
  "Private GitHub repos",
  "SaaS plans",
  "Paid APIs",
  "AI agent services",
  "Digital downloads",
  "License keys",
  "Discord communities",
];

const guides = NAV.find((s) => s.title === "Guides")?.items ?? [];

export default function OverviewPage() {
  return (
    <article>
      <h1>Sell software, APIs, and private repos in USDC</h1>
      <p className="lead">
        SettleKit lets developers sell private GitHub repos, SaaS subscriptions,
        API access, AI tools, templates, datasets, license keys, and digital
        downloads. Connect GitHub, create a product, set a USDC price, and share
        your checkout link. We handle payment verification, access delivery,
        subscriptions, license keys, webhooks, and customer portals.
      </p>

      <h2>What you can sell</h2>
      <div className="card-grid">
        {USE_CASES.map((label) => (
          <div className="card" key={label}>
            <p className="card__title">{label}</p>
          </div>
        ))}
      </div>

      <h2>How it works</h2>
      <ol className="steps">
        <li>
          <strong>Create a product.</strong> Describe what you are selling — a
          repo, a SaaS plan, a paid API, a file, or a license.
        </li>
        <li>
          <strong>Set a USDC price.</strong> One-time, monthly, yearly, lifetime,
          or per-call.
        </li>
        <li>
          <strong>Buyer pays.</strong> SettleKit verifies the on-chain USDC
          transfer before granting anything.
        </li>
        <li>
          <strong>Access is delivered.</strong> A repo invite, an entitlement, a
          license key, an API key, or a signed download — automatically.
        </li>
      </ol>

      <h2>One access model for everything</h2>
      <p>
        Under the hood every kind of access — GitHub, SaaS feature, API call,
        file, Discord role, license, agent tool — is modeled as a single{" "}
        <code>Entitlement</code>. The{" "}
        <code>@settlekit/entitlements</code> engine grants entitlements from a
        confirmed payment and answers one hot-path question for your app:{" "}
        <em>is this customer allowed?</em>
      </p>
      <CodeBlock language="ts" title="verify access in your app">
        {`import {
  EntitlementService,
  InMemoryEntitlementRepository,
} from "@settlekit/entitlements";

const entitlements = new EntitlementService(
  new InMemoryEntitlementRepository(),
);

const result = await entitlements.verify({
  customerId: "cus_123",
  feature: "ai_export",
});

if (!result.allowed) {
  throw new Error(result.reason ?? "upgrade_required");
}`}
      </CodeBlock>
      <p className="note">
        The same <code>verify</code> call backs SaaS feature flags, credit
        balances, and per-product access. Swap{" "}
        <code>InMemoryEntitlementRepository</code> for a database-backed
        repository in production — the service contract stays identical.
      </p>

      <h2>Developer tools</h2>
      <p>
        SDKs, webhooks, a universal entitlements engine, and{" "}
        <code>x402</code> pay-per-call middleware. Everything is published as
        small, composable <code>@settlekit/*</code> packages you can adopt one at
        a time, and a REST API exposes the same operations under{" "}
        <code>/v1</code>.
      </p>

      <h2>Pick a guide</h2>
      <div className="card-grid">
        {guides.map((item) => (
          <Link className="card" href={item.href} key={item.href}>
            <p className="card__title">{item.title}</p>
            <p className="card__desc">{item.description}</p>
          </Link>
        ))}
      </div>

      <h2>Marketplace and open source</h2>
      <p>
        Products and agent services can be listed in the SettleKit marketplace to
        get discovered by humans and AI agents. Self-host the open-source stack or
        use the hosted cloud — the package APIs are the same either way.
      </p>
      <p>
        Ready to ship? Start with the{" "}
        <Link href="/quickstart">Quickstart</Link>.
      </p>
    </article>
  );
}
