/**
 * Guide: GitHub repo sales (plan §3).
 *
 * Seller + buyer flows for selling private repository access in USDC, with real
 * code bound to @settlekit/github (grantGitHubRepoAccess) and the entitlement
 * grant flow.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { CodeBlock } from "../../../components/CodeBlock";

export const metadata: Metadata = {
  title: "GitHub repo sales",
  description:
    "Sell private GitHub repository access in USDC. Buyer pays, enters their GitHub username, and SettleKit invites them as a collaborator.",
};

export default function GithubRepoSalesPage() {
  return (
    <article>
      <h1>GitHub repo sales</h1>
      <p className="lead">
        Sell private repos, premium templates, boilerplates, private SDKs,
        trading bots, and course repositories. The buyer pays in USDC, enters
        their GitHub username, and SettleKit invites them to the repo or team.
        When a subscription lapses, access is removed.
      </p>

      <h2>What you can sell</h2>
      <ul>
        <li>Private GitHub repo access</li>
        <li>Premium open-source repo access</li>
        <li>Paid starter templates and boilerplates</li>
        <li>Private SDKs, AI agent code, and trading bots</li>
        <li>Private SaaS templates and automation scripts</li>
        <li>Private course / project repositories</li>
      </ul>

      <h2>Seller flow</h2>
      <ol className="steps">
        <li>Connect GitHub and install the SettleKit GitHub App.</li>
        <li>Select a repo or an organization team to sell.</li>
        <li>Create a price: one-time, monthly, yearly, or lifetime.</li>
        <li>SettleKit creates a hosted checkout page.</li>
        <li>The buyer pays in USDC and enters their GitHub username.</li>
        <li>SettleKit invites the buyer to the repo / team.</li>
        <li>The buyer gets an access page plus a receipt.</li>
        <li>If a subscription expires, SettleKit removes access.</li>
      </ol>

      <h2>Buyer flow</h2>
      <ol className="steps">
        <li>Open the checkout link.</li>
        <li>Pay 25 USDC.</li>
        <li>Enter a GitHub username.</li>
        <li>Accept the GitHub invite.</li>
        <li>Access the private repo and receive updates while active.</li>
      </ol>

      <h2>Granting access from a payment</h2>
      <p>
        After a payment is confirmed (see the{" "}
        <Link href="/quickstart">Quickstart</Link>), grant the universal
        entitlement for a <code>github_repo_access</code> product. The
        entitlement is the record of truth; the GitHub invite is the delivery
        action that fulfills it.
      </p>
      <CodeBlock language="ts" title="grant the repo entitlement">
        {`import {
  EntitlementService,
  InMemoryEntitlementRepository,
} from "@settlekit/entitlements";

const entitlements = new EntitlementService(
  new InMemoryEntitlementRepository(),
);

const entitlement = await entitlements.grantFromPayment({
  payment, // confirmed Payment from @settlekit/payments
  product: {
    id: "prod_repo_pro",
    merchantId: "mer_acme",
    organizationId: "org_acme",
    name: "Pro trading bot",
    description: "Private repo access",
    type: "github_repo_access",
    status: "active",
    deliveryMode: "github_invite",
    metadata: { repoOwner: "acme", repoName: "trading-bot" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
});`}
      </CodeBlock>

      <h2>Inviting the buyer</h2>
      <p>
        Once you have the buyer&apos;s GitHub username, call{" "}
        <code>grantGitHubRepoAccess</code> from{" "}
        <code>@settlekit/github</code>. It invites the user as a collaborator and
        returns a <code>GitHubRepoAccessGrant</code> whose status is{" "}
        <code>invited</code> (a pending invitation) or <code>active</code> (the
        user already had access). The function is idempotent: a repeat call or an
        existing collaborator is treated as success.
      </p>
      <CodeBlock language="ts" title="invite the buyer as a collaborator">
        {`import { grantGitHubRepoAccess } from "@settlekit/github";
import type { GitHubAccessClient } from "@settlekit/github";

// client is your authenticated GitHub App client (one per installation).
declare const client: GitHubAccessClient;

const grant = await grantGitHubRepoAccess(client, {
  organizationId: "org_acme",
  installationId: 42_000_000,
  customerId: "cus_123",
  entitlementId: entitlement.id,
  repoOwner: "acme",
  repoName: "trading-bot",
  githubUsername: "buyer-handle",
  permission: "pull", // "pull" | "push" | "maintain"
});

console.log(grant.status); // "invited" | "active"
if (grant.status === "invited") {
  console.log(grant.invitationId); // pending invite id`}
      </CodeBlock>
      <p className="note">
        When a subscription lapses, revoke access with the companion{" "}
        <code>revokeGitHubRepoAccess</code> helper and mark the entitlement
        revoked via <code>entitlements.revoke(entitlementId, reason)</code>.
      </p>

      <h2>Next</h2>
      <p>
        Selling recurring access? Pair this with{" "}
        <Link href="/guides/saas-billing">SaaS billing</Link> to drive the
        subscription lifecycle, or bundle a repo with other products in{" "}
        <Link href="/guides/bundles">Bundles</Link>.
      </p>
    </article>
  );
}
