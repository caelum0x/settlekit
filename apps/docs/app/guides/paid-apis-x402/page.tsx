/**
 * Guide: Paid APIs and x402 agent payments (plan §5).
 *
 * The real withSettleKitPayment export from @settlekit/x402 wraps a web Fetch
 * handler behind a verified pay-per-call challenge. The sample matches the true
 * SettleKitPaymentConfig: price, currency, productId, network, payTo, verify.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { CodeBlock } from "../../../components/CodeBlock";

export const metadata: Metadata = {
  title: "Paid APIs (x402)",
  description:
    "Charge per API call in USDC with HTTP 402 pay-per-call middleware. No API keys, no prepaid plans — agents discover, pay, and get the result.",
};

export default function PaidApisX402Page() {
  return (
    <article>
      <h1>Paid APIs and x402 agent payments</h1>
      <p className="lead">
        Charge per API call in USDC. Wrap a route with the SettleKit middleware
        and an unpaid request returns <code>HTTP 402 Payment Required</code> with
        machine-readable requirements. The caller pays, retries with proof, and
        gets the response. No API keys. No prepaid plans.
      </p>

      <h2>Why it matters</h2>
      <p>API businesses usually force buyers into:</p>
      <CodeBlock language="text">{`monthly subscription + API key + prepaid plan`}</CodeBlock>
      <p>But AI agents need:</p>
      <CodeBlock language="text">{`discover endpoint -> pay small amount -> get result`}</CodeBlock>
      <p>
        SettleKit makes a paid API as easy as adding middleware.
      </p>

      <h2>Wrap a handler with withSettleKitPayment</h2>
      <p>
        <code>withSettleKitPayment</code> is framework-agnostic: it takes a
        config and returns a wrapper around any web <code>Fetch</code> handler
        (<code>(Request) =&gt; Response</code>). The config requires the price,
        the settlement <code>network</code>, your <code>payTo</code> address, the{" "}
        <code>productId</code> for usage attribution, and a host-supplied{" "}
        <code>verify</code> function that confirms the payment on-chain.
      </p>
      <CodeBlock language="ts" title="app/api/research/route.ts">
        {`import { withSettleKitPayment } from "@settlekit/x402";
import type { PaymentProof, PaymentRequirements } from "@settlekit/x402";

// Host-supplied verifier: confirm the on-chain USDC transfer matches the
// challenge. In production this calls @settlekit/circle or @settlekit/arc.
async function verify(
  proof: PaymentProof,
  requirements: PaymentRequirements,
) {
  const paidEnough = Number(proof.amount) >= Number(requirements.amount);
  const nonceMatches = proof.nonce === requirements.nonce;
  return paidEnough && nonceMatches
    ? { ok: true }
    : { ok: false, reason: "payment_mismatch" };
}

export const GET = withSettleKitPayment({
  price: "0.005",
  currency: "USDC",
  productId: "prod_research_api",
  network: "arc", // "arc" | "base" | "ethereum"
  payTo: "0xYourUsdcPayoutWallet",
  verify,
})(async function handler(_req: Request) {
  return Response.json({ answer: "Paid research result" });
});`}
      </CodeBlock>

      <h2>The 402 challenge</h2>
      <p>
        On an unpaid call the middleware reads the <code>X-Payment</code> header.
        If it is absent or malformed, it returns a <code>402</code> whose body and{" "}
        <code>X-Payment-Required</code> header carry the{" "}
        <code>PaymentRequirements</code> — scheme, amount, asset, network,{" "}
        <code>payTo</code>, <code>productId</code>, resource, and a one-time{" "}
        <code>nonce</code> the caller must echo back.
      </p>
      <CodeBlock language="http" title="unpaid request -> 402">
        {`GET /api/research
-->
HTTP/1.1 402 Payment Required
X-Payment-Required: {"scheme":"x402","amount":"0.005","asset":"USDC",
  "network":"arc","payTo":"0x...","productId":"prod_research_api",
  "resource":"https://api.acme.dev/api/research","nonce":"..."}`}
      </CodeBlock>

      <h2>The paid retry</h2>
      <p>
        The caller pays the USDC transfer, base64-encodes a{" "}
        <code>PaymentProof</code> into the <code>X-Payment</code> header, and
        retries. The middleware parses the header, runs your{" "}
        <code>verify</code>, and on success runs the handler before firing the
        optional <code>settleAndMeter</code> hook.
      </p>
      <CodeBlock language="ts" title="encode the proof and meter usage">
        {`import { encodePaymentHeader } from "@settlekit/x402";

const header = encodePaymentHeader({
  txHash: "0xabc...",
  from: "0xBuyerWallet",
  amount: "0.005",
  network: "arc",
  nonce: "<nonce from the 402 challenge>",
});

await fetch("https://api.acme.dev/api/research", {
  headers: { "X-Payment": header },
});`}
      </CodeBlock>
      <p className="note">
        Pass <code>settleAndMeter</code> in the config to record a usage event
        after each successful paid call. Errors thrown there are swallowed so
        metering can never corrupt a served response.
      </p>

      <h2>List it for agents</h2>
      <p>
        To make a paid endpoint discoverable by AI agents with a machine-readable
        schema and price, publish it as an{" "}
        <Link href="/guides/agent-services">agent service</Link>.
      </p>
    </article>
  );
}
