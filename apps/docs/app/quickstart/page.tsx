/**
 * Quickstart (plan §34 "How it works").
 *
 * Walks the four-step flow — connect, create a product, set a price, share a
 * checkout link — with real code bound to @settlekit/payments and
 * @settlekit/entitlements exports.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { CodeBlock } from "../../components/CodeBlock";

export const metadata: Metadata = {
  title: "Quickstart",
  description:
    "Connect GitHub, create a product, set a USDC price, and share your hosted checkout link.",
};

export default function QuickstartPage() {
  return (
    <article>
      <h1>Quickstart</h1>
      <p className="lead">
        Go from zero to a shareable USDC checkout link. Each step maps to a real{" "}
        <code>@settlekit/*</code> package function — the same ones the hosted API
        calls under <code>/v1</code>.
      </p>

      <h2>1. Connect</h2>
      <p>
        Authenticate and pick your payout wallet. The wallet address is the{" "}
        <code>payToAddress</code> that every checkout session settles to, so the
        on-chain USDC transfer lands directly in your account before access is
        granted.
      </p>
      <CodeBlock language="bash" title="install the SDK packages">
        {`pnpm add @settlekit/payments @settlekit/entitlements`}
      </CodeBlock>

      <h2>2. Create a product</h2>
      <p>
        A product is the thing you sell. For pricing you attach a{" "}
        <code>Price</code> — a USDC <code>Money</code> amount and an interval.
        Build a priced line item the checkout can total:
      </p>
      <CodeBlock language="ts" title="define a priced line item">
        {`import type { PricedLineItem } from "@settlekit/payments";

// "25 USDC, one time" expressed as a priced line item. The Price.amount is a
// decimal string in USDC major units; the line item references it by id.
const item: PricedLineItem = {
  lineItem: {
    productId: "prod_repo_pro",
    priceId: "price_one_time_25",
    quantity: 1,
  },
  price: {
    id: "price_one_time_25",
    productId: "prod_repo_pro",
    amount: "25.00",
    currency: "USDC",
    interval: "one_time",
    usageBased: false,
    active: true,
    createdAt: new Date().toISOString(),
  },
};`}
      </CodeBlock>
      <p className="note">
        The <code>Money</code>, <code>Price</code>, and <code>Currency</code>{" "}
        types come from <code>@settlekit/common</code>, the shared contract
        package every other package depends on. Amounts are decimal strings in
        USDC major units (six decimals of precision).
      </p>

      <h2>3. Set a price and create the checkout</h2>
      <p>
        <code>createCheckoutSession</code> computes the total from your line
        items with <code>computeCheckoutTotal</code>, binds the session to your
        payout wallet and network, and returns an immutable{" "}
        <code>CheckoutSession</code> with an id you can put behind a link.
      </p>
      <CodeBlock language="ts" title="create a checkout session">
        {`import { createCheckoutSession } from "@settlekit/payments";

const session = createCheckoutSession({
  organizationId: "org_acme",
  merchantId: "mer_acme",
  items: [item],
  payToAddress: "0xYourUsdcPayoutWallet",
  network: "arc",
  successUrl: "https://acme.dev/thanks",
  cancelUrl: "https://acme.dev/pricing",
});

// session.id, session.amount (total), session.status === "open"
console.log(session.id, session.amount, session.status);`}
      </CodeBlock>

      <h2>4. Share the checkout link</h2>
      <p>
        Point buyers at the hosted checkout for the session id. When the buyer
        pays, you record a pending payment, confirm it once the transfer reaches
        the required confirmations, then grant access from the confirmed payment:
      </p>
      <CodeBlock language="ts" title="confirm payment, then grant access">
        {`import {
  recordPendingPayment,
  confirmPayment,
} from "@settlekit/payments";
import {
  EntitlementService,
  InMemoryEntitlementRepository,
} from "@settlekit/entitlements";

// 1) buyer submits an on-chain transfer for the session total
let payment = recordPendingPayment({
  organizationId: "org_acme",
  customerId: "cus_123",
  checkoutSessionId: session.id,
  amount: session.amount,
  network: "arc",
  txHash: "0xabc...",
});

// 2) once the transfer reaches the required confirmations
//    confirmPayment(payment, txHash, confirmations, minConfirmations?)
payment = confirmPayment(payment, "0xabc...", 12);

// 3) grant the universal entitlement from the confirmed payment
const entitlements = new EntitlementService(
  new InMemoryEntitlementRepository(),
);

const entitlement = await entitlements.grantFromPayment({
  payment,
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
});

console.log(entitlement.status); // "active"`}
      </CodeBlock>

      <h2>Next steps</h2>
      <ul>
        <li>
          Sell a private repo end to end:{" "}
          <Link href="/guides/github-repo-sales">GitHub repo sales</Link>.
        </li>
        <li>
          Gate SaaS features with one verify call:{" "}
          <Link href="/guides/saas-billing">SaaS billing</Link>.
        </li>
        <li>
          Charge per API call with no API keys:{" "}
          <Link href="/guides/paid-apis-x402">Paid APIs (x402)</Link>.
        </li>
        <li>
          Browse every REST route:{" "}
          <Link href="/api-reference">API reference</Link>.
        </li>
      </ul>
    </article>
  );
}
