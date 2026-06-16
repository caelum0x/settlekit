/**
 * Runnable end-to-end SettleKit SDK example.
 *
 * Drives the full sale: product → price → customer → checkout → payment →
 * confirm (entitlement granted) → usage credits → analytics summary. Every call
 * hits a live SettleKit API.
 *
 * Run against a running API (see the repo README to start one):
 *   SETTLEKIT_API_URL=http://localhost:8787 \
 *   SETTLEKIT_API_KEY=dev-key \
 *   node --import tsx/esm packages/sdk/examples/full-flow.ts
 */
import { SettleKit, SettleKitApiError } from "../src/index.js";

async function main(): Promise<void> {
  const sk = new SettleKit({
    apiKey: process.env.SETTLEKIT_API_KEY ?? "dev-key",
    baseUrl: process.env.SETTLEKIT_API_URL ?? "http://localhost:8787",
  });

  const org = "org_settlekit_default";
  const merchant = "mch_settlekit_default";

  // 1. Product + price
  const product = await sk.products.create({
    merchantId: merchant,
    organizationId: org,
    name: "Pro Repo Access",
    description: "Private repo + updates",
    type: "github_repo_access",
    deliveryMode: "github_invite",
  });
  const price = await sk.products.createPrice(product.id, { amount: "25.00", interval: "one_time" });
  console.log("product", product.id, "price", price.id);

  // 2. Customer + checkout session
  const customer = await sk.customers.create({ organizationId: org, email: "buyer@example.com" });
  const session = await sk.checkout.create({
    organizationId: org,
    merchantId: merchant,
    customerId: customer.id,
    items: [{ priceId: price.id, productId: product.id, quantity: 1 }],
    payToAddress: "0xMerchantWallet",
    network: "base",
  });
  console.log("session", session.id, session.amount);

  // 3. Record + confirm the payment → entitlement granted
  const payment = await sk.payments.record({ checkoutSessionId: session.id });
  const confirmed = await sk.payments.confirm(payment.id, { txHash: "0xabc123", confirmations: 3 });
  console.log("entitlements granted:", confirmed.entitlements.length);

  // 4. Usage-based billing
  await sk.usage.grantCredits({ organizationId: org, customerId: customer.id, productId: product.id, credits: 1000 });
  const balance = await sk.usage.consumeCredits({ organizationId: org, customerId: customer.id, productId: product.id, credits: 5 });
  console.log("credits remaining:", balance.creditsRemaining);

  // 5. Live analytics
  const summary = await sk.analytics.summary(org);
  console.log("revenue:", summary.revenue, "customers:", summary.customers, "activeAccess:", summary.activeAccess);
}

main().catch((err) => {
  if (err instanceof SettleKitApiError) {
    console.error(`SettleKit error [${err.code}] (${err.status}): ${err.message}`);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
