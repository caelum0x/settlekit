import type { Metadata } from "next";
import { links } from "@/lib/links";
import { API_URL, ONBOARDING_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Integrate SettleKit with your SaaS",
  description:
    "Sell your SaaS plans in USDC: a payment link, an embeddable button, signed webhooks, and an entitlement check to unlock paid features.",
};

const CHECKOUT_URL = (process.env.NEXT_PUBLIC_CHECKOUT_URL ?? "https://checkout.example.com").replace(/\/+$/, "");

const LINK_SNIPPET = `${CHECKOUT_URL}/l/your-product-slug`;

const BUTTON_SNIPPET = `<a href="${CHECKOUT_URL}/l/your-product-slug"
   style="display:inline-block;padding:12px 20px;border-radius:6px;
          background:#1e40a2;color:#fff;font:600 15px system-ui;text-decoration:none">
  Subscribe with USDC
</a>`;

const OVERLAY_SNIPPET = `<script src="${CHECKOUT_URL}/embed.js" async></script>

<a href="${CHECKOUT_URL}/l/your-product-slug" data-settlekit-checkout>Subscribe with USDC</a>

<script>
  // Optional: react when the payment settles (sites listed under
  // Settings > Embedding receive this; others still get a working checkout).
  document.addEventListener("settlekit:success", (event) => {
    console.info("paid", event.detail.sessionId, event.detail.paymentId);
  });
  // Or open it from code:
  // SettleKit.open("${CHECKOUT_URL}/l/your-product-slug", { onSuccess: (d) => {}, onClose: () => {} });
</script>`;

const SESSION_SNIPPET = `// Open a fresh checkout for a signed-in user and send them to it.
const res = await fetch("${API_URL}/v1/public/links/your-product-slug/sessions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ successUrl: "https://app.example.com/billing?paid=1" }),
});
const { data } = await res.json();
redirect(\`${CHECKOUT_URL}/c/\${data.sessionId}\`);`;

const VERIFY_SNIPPET = `import { createHmac, timingSafeEqual } from "node:crypto";
import express from "express";

const app = express();
const SECRET = process.env.SETTLEKIT_WEBHOOK_SECRET; // Dashboard > Webhooks > Reveal
const TOLERANCE_SECONDS = 300;

/**
 * SettleKit-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
 * After a secret rotation the header carries one v1 per active secret for a
 * grace period, so accept the delivery when ANY v1 matches.
 */
function verify(rawBody, header) {
  const parts = header.split(",").map((kv) => kv.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isInteger(t) || signatures.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - t) > TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", SECRET).update(\`\${t}.\${rawBody}\`).digest();
  return signatures.some((v1) => {
    const given = Buffer.from(v1, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

// Use the RAW body: re-serialized JSON will not match the signature.
app.post("/webhooks/settlekit", express.raw({ type: "application/json" }), async (req, res) => {
  const raw = req.body.toString("utf8");
  if (!verify(raw, req.get("SettleKit-Signature") ?? "")) return res.status(400).send("bad signature");
  const event = JSON.parse(raw); // { id, type, organizationId, data, createdAt }

  switch (event.type) {
    case "payment.confirmed":      // one-time purchase or a subscription period
    case "subscription.charged":   // renewal collected; data.currentPeriodEnd
      await grantPlan(event.data.customerEmail, event.data.customerId, event.data.productIds ?? [event.data.productId]);
      break;
    case "subscription.canceled":  // data.cancelAtPeriodEnd: keep access until the period ends
    case "refund.succeeded":
      await scheduleDowngrade(event.data.customerId);
      break;
  }
  res.sendStatus(200); // anything else is retried with backoff
});`;

const ENTITLEMENT_SNIPPET = `// Server-side only: create the key in Dashboard > API keys.
async function hasPaidPlan(email, productId) {
  const res = await fetch("${API_URL}/v1/entitlements/verify", {
    method: "POST",
    headers: {
      authorization: \`Bearer \${process.env.SETTLEKIT_API_KEY}\`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, productId }), // or { customerId } from the webhook
  });
  const { data } = await res.json(); // { allowed, reason?, entitlement? }
  return data.allowed === true;
}`;

const PAYLOAD_SNIPPET = `{
  "id": "evt_4c1f0d2a9b7e6c5d4e3f2a1b",
  "type": "subscription.charged",
  "organizationId": "org_...",
  "createdAt": "2026-10-01T12:00:00.000Z",
  "data": {
    "subscriptionId": "sub_...",
    "onchainSubscriptionId": "osub_...",
    "customerId": "cus_...",
    "customerEmail": "buyer@example.com",
    "productId": "prod_...",
    "network": "base",
    "method": "permit2",
    "periodIndex": 1,
    "amount": "29",
    "txHash": "0x...",
    "currentPeriodEnd": "2026-10-31T12:00:00.000Z"
  }
}`;

const EVENTS: { type: string; when: string }[] = [
  { type: "payment.confirmed", when: "A payment settled on-chain (checkout, subscription pull, AI agent). data.paymentId, customerId, customerEmail, productIds, amount, network, txHash." },
  { type: "subscription.charged", when: "A subscription period was collected. data.periodIndex, amount, txHash, currentPeriodEnd." },
  { type: "subscription.canceled", when: "The buyer or you canceled. data.cancelAtPeriodEnd, canceledBy (buyer | merchant)." },
  { type: "refund.succeeded", when: "Funds went back to the buyer. data.refundId, paymentId, amount, txHash, source (operator | escrow | manual)." },
];

function Code({ children }: { children: string }) {
  return (
    <pre className="doc-code">
      <code>{children}</code>
    </pre>
  );
}

function Section({ no, title, children }: { no: string; title: string; children: React.ReactNode }) {
  return (
    <section className="section doc-section">
      <div className="container doc-body">
        <div className="ref">
          <span className="ref-no">§ {no}</span>
          <span>{title}</span>
          <span className="ref-fill" aria-hidden="true" />
        </div>
        {children}
      </div>
    </section>
  );
}

/**
 * Integration guide for SaaS sellers (e.g. an app unlocking a paid plan):
 * payment link, embed button, signed webhooks, entitlement checks.
 */
export default function IntegratePage() {
  return (
    <>
      <section className="section page-hero">
        <div className="container doc-body">
          <div className="section-head">
            <h1 className="section-title">Unlock paid plans in your app</h1>
            <p className="section-desc">
              Four pieces: a payment link, a button, a signed webhook, and one API call to check access. Buyers pay in USDC
              on the chain they already use; monthly and yearly prices can be paid as subscriptions.
            </p>
          </div>
          <p>
            <a className="btn btn-primary" href={ONBOARDING_URL}>
              Create a product
            </a>{" "}
            <a className="btn btn-ghost" href={`${links.dashboard}/webhooks`}>
              Add a webhook
            </a>
          </p>
        </div>
      </section>

      <Section no="01" title="Payment link">
        <p>
          In the dashboard, create a product with a monthly or yearly price and delivery &quot;App access&quot;. Its
          payment link is permanent and opens a fresh checkout per visit:
        </p>
        <Code>{LINK_SNIPPET}</Code>
        <p>
          On a recurring price the buyer can subscribe with one wallet approval capped at price x periods (smart-wallet
          spend permission, Permit2, or a Solana delegate) or choose emailed renewal invoices. The first period is charged
          immediately; later ones are collected on schedule and paid straight to your wallet.
        </p>
      </Section>

      <Section no="02" title="Embed a button">
        <p>Any page, no script needed:</p>
        <Code>{BUTTON_SNIPPET}</Code>
        <p>
          To keep buyers on your page, add <span className="mono">embed.js</span>: links marked{" "}
          <span className="mono">data-settlekit-checkout</span> open the checkout in an overlay. Add your site under
          Settings &gt; Embedding to receive the success event.
        </p>
        <Code>{OVERLAY_SNIPPET}</Code>
        <p>To send a signed-in user to checkout and back to your app afterwards, open the session from your server:</p>
        <Code>{SESSION_SNIPPET}</Code>
      </Section>

      <Section no="03" title="Verify webhooks (Node)">
        <p>
          Every event is POSTed with <span className="mono">SettleKit-Signature: t=..,v1=..</span> and{" "}
          <span className="mono">SettleKit-Event</span> headers, signed with your endpoint&apos;s secret. Non-2xx
          responses are retried with backoff; event ids are stable, so handle them idempotently.
        </p>
        <Code>{VERIFY_SNIPPET}</Code>
        <table className="doc-table">
          <thead>
            <tr>
              <th>Event</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {EVENTS.map((e) => (
              <tr key={e.type}>
                <td className="mono">{e.type}</td>
                <td>{e.when}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>Example payload:</p>
        <Code>{PAYLOAD_SNIPPET}</Code>
      </Section>

      <Section no="04" title="Check entitlement">
        <p>
          Webhooks tell you when access changes; the entitlement API is the source of truth whenever you need to check.
          Access stays active through the paid period and is expired automatically if a renewal fails after dunning.
        </p>
        <Code>{ENTITLEMENT_SNIPPET}</Code>
        <p>
          List everything a buyer owns with <span className="mono">GET /v1/entitlements?email=buyer@example.com&amp;activeOnly=true</span>.
          Keep the API key on your server; never ship it to a browser.
        </p>
      </Section>
    </>
  );
}
