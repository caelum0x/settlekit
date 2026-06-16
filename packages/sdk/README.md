# @settlekit/sdk

The official **SettleKit** TypeScript/Node SDK — a typed client for the entire
SettleKit `/v1` API. Sell software, private repos, SaaS, APIs, and AI tools in
USDC and automate access delivery, all from Node.

## Install

```bash
pnpm add @settlekit/sdk    # within the monorepo it's already a workspace package
```

## Quick start

```ts
import { SettleKit } from "@settlekit/sdk";

const sk = new SettleKit({
  apiKey: process.env.SETTLEKIT_API_KEY!,
  baseUrl: process.env.SETTLEKIT_API_URL ?? "http://localhost:8787",
});

const product = await sk.products.create({
  merchantId: "mch_1",
  organizationId: "org_1",
  name: "Pro Repo Access",
  type: "github_repo_access",
  deliveryMode: "github_invite",
});
await sk.products.createPrice(product.id, { amount: "25.00", interval: "monthly" });

const products = await sk.products.list();
```

The client unwraps the `{ data }` envelope and throws a typed
`SettleKitApiError` (with `.code`, `.message`, `.status`) on any `{ error }`
response. Pass a per-call `RequestOptions` (`{ signal, headers }`) to any method.

## Resources

| Accessor | Endpoints |
| --- | --- |
| `sk.products` / `sk.prices` | products + prices |
| `sk.customers` | customers |
| `sk.checkout` | checkout sessions |
| `sk.payments` | record / confirm / refund payments |
| `sk.subscriptions` | subscriptions |
| `sk.entitlements` | grant + verify entitlements |
| `sk.licenseKeys` | issue + verify license keys |
| `sk.apiKeys` | issue + verify API keys |
| `sk.bundles` | multi-product bundles |
| `sk.files` | digital download grants |
| `sk.webhooks` | endpoints + events |
| `sk.deliveryRuns` | delivery run audit trail |
| `sk.agentServices` | AI agent service listings |
| `sk.escrow` | escrow tasks |
| `sk.github` / `sk.discord` | access integrations |
| `sk.saas` | plans, features, seats |
| `sk.usage` | metering + prepaid credits |
| `sk.marketplace` | listings + discovery + seller profiles |
| `sk.analytics` | merchant dashboard summary |
| `sk.coupons` | discount codes |
| `sk.invoices` | invoices |
| `sk.payouts` | merchant settlement |

## Examples

```ts
// Usage-based billing
await sk.usage.grantCredits({ organizationId: "org_1", customerId: "cus_1", productId: "prod_api", credits: 20000 });
await sk.usage.consumeCredits({ organizationId: "org_1", customerId: "cus_1", productId: "prod_api", credits: 1 });

// Publish to the marketplace
const listing = await sk.marketplace.createListing({
  organizationId: "org_1", merchantId: "mch_1", productId: product.id,
  title: "AI SaaS Boilerplate", summary: "Next.js + USDC billing", tags: ["nextjs", "saas"],
});
await sk.marketplace.publish(listing.id);

// Discounts + dashboard summary
await sk.coupons.create({ code: "LAUNCH20", discount: { type: "percent", percentOff: 20 } });
const summary = await sk.analytics.summary("org_1");
console.log(summary.revenue, summary.mrr, summary.revenueSeries);

// Verify access from your app
const { active } = await sk.licenseKeys.verify({ licenseKey: "SK-XXXX", productId: product.id, machineId: "m1" });
```

A runnable end-to-end script lives in
[`examples/full-flow.ts`](./examples/full-flow.ts).

## Errors

```ts
import { SettleKitApiError } from "@settlekit/sdk";

try {
  await sk.payments.confirm(paymentId, { txHash: "0x…", confirmations: 3 });
} catch (err) {
  if (err instanceof SettleKitApiError) {
    console.error(err.code, err.message, err.status);
  }
}
```

See [docs/API.md](../../docs/API.md) for the full endpoint reference.
