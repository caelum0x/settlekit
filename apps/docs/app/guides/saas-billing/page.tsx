/**
 * Guide: SaaS billing (plan §4).
 *
 * Plans, entitlements, feature flags, and seats — with the real verify SDK
 * (EntitlementService.verify) and @settlekit/saas plan/feature helpers.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { CodeBlock } from "../../../components/CodeBlock";

export const metadata: Metadata = {
  title: "SaaS billing",
  description:
    "Sell SaaS plans in USDC and gate features with a single entitlement verify call.",
};

export default function SaasBillingPage() {
  return (
    <article>
      <h1>SaaS billing</h1>
      <p className="lead">
        Sell subscriptions, lifetime deals, team seats, usage credits, and
        premium feature unlocks. Define entitlements once, then check them in
        your app with a single <code>verify</code> call.
      </p>

      <h2>Seller flow</h2>
      <ol className="steps">
        <li>Create a SaaS product.</li>
        <li>
          Create plans — for example Free, Pro, Team, and Business.
        </li>
        <li>
          Define entitlements per plan, such as <code>max_projects = 10</code>,{" "}
          <code>max_api_calls = 100000</code>,{" "}
          <code>feature_ai_export = true</code>, and{" "}
          <code>team_seats = 5</code>.
        </li>
        <li>Install the SDK in your SaaS app.</li>
        <li>The buyer pays in USDC; your app checks the entitlement.</li>
      </ol>

      <h2>Define plans with @settlekit/saas</h2>
      <p>
        Plans carry feature flags (booleans) and numeric limits. Use{" "}
        <code>createPlan</code> to build a validated <code>SaasPlan</code> and{" "}
        <code>UNLIMITED</code> for limits with no ceiling. It returns a{" "}
        <code>Result</code>, so unwrap <code>.value</code> on success.
      </p>
      <CodeBlock language="ts" title="create plans">
        {`import { createPlan, UNLIMITED } from "@settlekit/saas";

const pro = createPlan({
  productId: "prod_saas",
  name: "Pro",
  interval: "monthly", // "monthly" | "yearly"
  price: { amount: "29.00", currency: "USDC" },
  features: { ai_export: true, max_projects: 100 },
  seats: 5,
});

const business = createPlan({
  productId: "prod_saas",
  name: "Business",
  interval: "monthly",
  price: { amount: "99.00", currency: "USDC" },
  features: { ai_export: true, max_projects: UNLIMITED },
  seats: 25,
});

if (!pro.ok) throw new Error(pro.error.message);
const proPlan = pro.value; // SaasPlan`}
      </CodeBlock>

      <h2>The verify SDK (plan §4)</h2>
      <p>
        Every kind of access is an <code>Entitlement</code>, so feature gating is
        one call. <code>EntitlementService.verify</code> resolves the customer&apos;s
        active entitlements and applies the requested feature / credit check,
        returning <code>{`{ allowed, reason }`}</code>.
      </p>
      <CodeBlock language="ts" title="gate a feature in your SaaS app">
        {`import {
  EntitlementService,
  InMemoryEntitlementRepository,
} from "@settlekit/entitlements";

const entitlements = new EntitlementService(
  new InMemoryEntitlementRepository(),
);

const result = await entitlements.verify({
  customerId: user.id,
  feature: "ai_export",
});

if (!result.allowed) {
  throw new Error(result.reason ?? "upgrade_required");
}`}
      </CodeBlock>
      <p className="note">
        The hosted API exposes the same check at{" "}
        <code>POST /v1/entitlements/verify</code> — see the{" "}
        <Link href="/api-reference">API reference</Link>. The SaaS-specific
        variant lives at <code>POST /v1/saas/entitlements/verify</code>.
      </p>

      <h2>Metered features and credits</h2>
      <p>
        For credit-based plans, verify a required balance and spend against it.
        <code>verify</code> accepts <code>requiredCredits</code>;{" "}
        <code>spendCredits</code> deducts and persists the new balance.
      </p>
      <CodeBlock language="ts" title="check and spend credits">
        {`// gate: does the customer have at least 10 credits for this product?
const check = await entitlements.verify({
  customerId: user.id,
  productId: "prod_saas",
  requiredCredits: 10,
});

if (check.allowed) {
  // deduct 10 credits and persist the new balance
  await entitlements.spendCredits(user.id, "prod_saas", 10);
}`}
      </CodeBlock>

      <h2>Grant on purchase</h2>
      <p>
        When a buyer purchases a plan, grant the entitlement from the confirmed
        payment (or from a subscription for recurring access). The features map
        flows straight into the entitlement so <code>verify</code> can read it.
      </p>
      <CodeBlock language="ts" title="grant a saas entitlement from payment">
        {`const entitlement = await entitlements.grantFromPayment({
  payment, // confirmed Payment
  product: {
    id: "prod_saas",
    merchantId: "mer_acme",
    organizationId: "org_acme",
    name: "Acme Pro",
    description: "Pro plan",
    type: "saas_plan",
    status: "active",
    deliveryMode: "saas_entitlement",
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  features: { ai_export: true, max_projects: 100, team_seats: 5 },
});`}
      </CodeBlock>

      <h2>Next</h2>
      <p>
        Charge per call instead of per month with{" "}
        <Link href="/guides/paid-apis-x402">Paid APIs (x402)</Link>, or hand out{" "}
        <Link href="/guides/license-keys">license keys</Link> for offline apps.
      </p>
    </article>
  );
}
