/**
 * Guide: License keys.
 *
 * Issue, verify, and activate offline license keys with the real
 * @settlekit/license-keys LicenseService surface.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { CodeBlock } from "../../../components/CodeBlock";

export const metadata: Metadata = {
  title: "License keys",
  description:
    "Issue and verify offline license keys with machine/domain activation limits and signed offline tokens.",
};

export default function LicenseKeysPage() {
  return (
    <article>
      <h1>License keys</h1>
      <p className="lead">
        Sell desktop apps, plugins, and CLIs that activate offline. SettleKit
        issues license keys bound to a customer and product, enforces machine and
        domain activation limits, and can hand out signed tokens that verify
        without a network round-trip.
      </p>

      <h2>Issue a key</h2>
      <p>
        <code>LicenseService</code> wraps a store plus a token secret.{" "}
        <code>issue</code> takes a <code>CreateLicenseKeyInput</code> — the
        organization, customer, product, the entitlement it fulfills, and the
        activation limits — and returns a <code>LicenseKey</code>.
      </p>
      <CodeBlock language="ts" title="issue a license key">
        {`import {
  LicenseService,
  InMemoryLicenseStore,
} from "@settlekit/license-keys";

const licenses = new LicenseService(new InMemoryLicenseStore(), {
  tokenSecret: process.env.LICENSE_TOKEN_SECRET!,
});

const license = await licenses.issue({
  organizationId: "org_acme",
  customerId: "cus_123",
  productId: "prod_desktop_app",
  entitlementId: "ent_456",
  machineLimit: 3,
  domainLimit: 1,
  // expiresAt is optional for perpetual licenses
});

console.log(license.key); // the key string to deliver to the buyer`}
      </CodeBlock>

      <h2>Verify a key</h2>
      <p>
        Your app calls <code>verify</code> with the key string, the product, and
        a stable machine id. The service evaluates status (active, revoked,
        expired, machine-limit) and, when a new machine activates, persists the
        updated activation list.
      </p>
      <CodeBlock language="ts" title="verify on app launch">
        {`const result = await licenses.verify({
  licenseKey: userEnteredKey,
  productId: "prod_desktop_app",
  machineId: "machine-fingerprint-abc",
});

if (!result.active) {
  throw new Error(result.reason ?? "license_invalid");
}`}
      </CodeBlock>
      <p className="note">
        <code>VerifyResult.reason</code> is one of the typed{" "}
        <code>VerifyReason</code> values (for example{" "}
        <code>not_found</code>, <code>revoked</code>, <code>expired</code>,{" "}
        <code>machine_limit</code>), so your UI can show a precise message.
      </p>

      <h2>Offline tokens</h2>
      <p>
        For fully offline apps, issue a signed token the client verifies locally
        against the public payload — no call back to SettleKit needed until the
        token expires.
      </p>
      <CodeBlock language="ts" title="issue a signed offline token">
        {`// Sign a short-lived token bound to the license id.
const token = await licenses.issueToken(license.id);

// Ship the token with the app; the client verifies it offline with the same
// secret (or a verifying key) using verifyLicenseToken from the package.`}
      </CodeBlock>

      <h2>Activation management</h2>
      <p>
        Move a license between machines or revoke it entirely. Each call returns
        a new, persisted <code>LicenseKey</code> — the underlying domain
        functions are immutable.
      </p>
      <CodeBlock language="ts" title="manage activations">
        {`await licenses.activateMachine(license.id, "machine-fingerprint-xyz");
await licenses.deactivateMachine(license.id, "machine-fingerprint-abc");
await licenses.revoke(license.id);`}
      </CodeBlock>

      <h2>Next</h2>
      <p>
        Prefer per-call billing for an API instead of a license? See{" "}
        <Link href="/guides/paid-apis-x402">Paid APIs (x402)</Link>. Want to
        bundle a license with other products?{" "}
        <Link href="/guides/bundles">Bundles</Link>.
      </p>
    </article>
  );
}
