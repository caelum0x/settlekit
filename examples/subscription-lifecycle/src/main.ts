/**
 * Subscription lifecycle walkthrough (TypeScript) using `@settlekit/sdk`.
 *
 * Runs the full recurring-billing arc against a live SettleKit API:
 *
 *   1. create a customer, a product, and a recurring (monthly) price
 *   2. create a subscription  → an entitlement is granted automatically
 *   3. verify the customer's access to the product (the SDK hot path)
 *   4. a payment fails: open a dunning campaign, record a failed attempt,
 *      then recover it
 *   5. cancel the subscription
 *
 * Connection comes from env (with local defaults):
 *   SETTLEKIT_API_URL   (default http://localhost:8787)
 *   SETTLEKIT_API_KEY   (required — Bearer key; use API_BOOTSTRAP_KEY locally)
 *   SETTLEKIT_ORG_ID    (default org_demo)
 *
 * Prerequisite: build the SDK first — `pnpm --filter @settlekit/sdk build`.
 */
import { SettleKit, SettleKitApiError } from "./sdk.js";

const API_URL = process.env.SETTLEKIT_API_URL ?? "http://localhost:8787";
const API_KEY = process.env.SETTLEKIT_API_KEY;
const ORG_ID = process.env.SETTLEKIT_ORG_ID ?? "org_demo";

function step(title: string): void {
  process.stdout.write(`\n=== ${title} ===\n`);
}

async function main(): Promise<void> {
  if (!API_KEY) {
    throw new Error(
      "Set SETTLEKIT_API_KEY (Bearer key). For local dev, start the API with " +
        "API_BOOTSTRAP_KEY=sk_dev and use that value.",
    );
  }

  const sk = new SettleKit({ apiKey: API_KEY, baseUrl: API_URL });

  step("1. Create customer, product, recurring price");
  const customer = await sk.customers.create({
    organizationId: ORG_ID,
    email: `subscriber+${Date.now()}@example.com`,
    name: "Example Subscriber",
  });
  console.log(`customer: ${customer.id}`);

  const product = await sk.products.create({
    merchantId: "mch_example",
    organizationId: ORG_ID,
    name: "Pro Plan",
    type: "saas_plan",
    deliveryMode: "saas_entitlement",
  });
  console.log(`product:  ${product.id}`);

  const price = await sk.products.createPrice(product.id, {
    amount: "19.00",
    interval: "monthly",
  });
  console.log(`price:    ${price.id} (${price.amount} ${price.currency}/${price.interval})`);

  step("2. Subscribe (grants an entitlement)");
  const { subscription, entitlement } = await sk.subscriptions.create({
    organizationId: ORG_ID,
    customerId: customer.id,
    productId: product.id,
    priceId: price.id,
  });
  console.log(`subscription: ${subscription.id} [${subscription.status}]`);
  console.log(`entitlement:  ${entitlement.id} (granted by ${entitlement.grantedBy?.type})`);

  step("3. Verify access");
  const access = await sk.entitlements.verify({
    customerId: customer.id,
    productId: product.id,
  });
  console.log(`allowed: ${access.allowed}${access.reason ? ` (${access.reason})` : ""}`);

  step("4. Payment failed → dunning → recovery");
  const started = await sk.dunning.start(subscription.id);
  console.log(`dunning started: status=${started.status} attempt=${started.attempt}`);
  const attempted = await sk.dunning.attempt(subscription.id, "failed", "card_declined");
  console.log(`attempt failed:  status=${attempted.status} attempt=${attempted.attempt}`);
  const recovered = await sk.dunning.recover(subscription.id);
  console.log(`recovered:       status=${recovered.status}`);

  step("5. Cancel subscription");
  const canceled = await sk.subscriptions.cancel(subscription.id);
  console.log(
    `canceled: status=${canceled.status} cancelAtPeriodEnd=${canceled.cancelAtPeriodEnd}`,
  );

  process.stdout.write("\n✓ Subscription lifecycle complete.\n");
}

main().catch((err: unknown) => {
  if (err instanceof SettleKitApiError) {
    process.stderr.write(`\nAPI error [${err.code}]: ${err.message}\n`);
  } else {
    process.stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n`);
  }
  process.exitCode = 1;
});
