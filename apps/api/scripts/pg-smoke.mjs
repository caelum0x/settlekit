/**
 * Live Postgres smoke test (not a unit test): drives the real API end-to-end
 * against a running Postgres via the built dist, then leaves the rows behind for
 * external verification with psql. Run with DATABASE_URL + API_BOOTSTRAP_KEY set.
 */
import { createApp } from "../dist/app.js";
import { createContext } from "../dist/context.js";

const KEY = process.env.API_BOOTSTRAP_KEY ?? "smoke-key";

async function main() {
  const ctx = await createContext();
  const app = createApp(ctx);

  async function call(method, path, body) {
    const res = await app.request(path, {
      method,
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json();
    return { status: res.status, json };
  }

  const log = (label, r) => {
    console.log(`${label}: ${r.status} ${r.json.error ? JSON.stringify(r.json.error) : "ok"}`);
    if (r.status >= 400) throw new Error(`${label} failed: ${JSON.stringify(r.json)}`);
  };

  console.log(`persistent=${ctx.persistent}`);

  const product = await call("POST", "/v1/products", {
    merchantId: "mch_1", organizationId: "org_1", name: "Pro Repo Access",
    description: "Private repo", type: "github_repo_access", deliveryMode: "github_invite",
  });
  log("product", product);
  const productId = product.json.data.id;

  const price = await call("POST", `/v1/products/${productId}/prices`, { amount: "25.00", interval: "one_time" });
  log("price", price);
  const priceId = price.json.data.id;

  const customer = await call("POST", "/v1/customers", {
    organizationId: "org_1", email: "buyer@example.com", githubUsername: "octocat",
  });
  log("customer", customer);
  const customerId = customer.json.data.id;

  const checkout = await call("POST", "/v1/checkout-sessions", {
    organizationId: "org_1", merchantId: "mch_1", customerId,
    items: [{ priceId, productId, quantity: 1 }], payToAddress: "0xMerchantWallet", network: "base",
  });
  log("checkout", checkout);
  const sessionId = checkout.json.data.id;
  console.log(`  checkout amount=${checkout.json.data.amount.amount}`);

  const payment = await call("POST", "/v1/payments", { checkoutSessionId: sessionId });
  log("payment", payment);
  const paymentId = payment.json.data.id;

  const confirmed = await call("POST", `/v1/payments/${paymentId}/confirm`, { txHash: "0xabc123", confirmations: 3 });
  log("confirm", confirmed);
  console.log(`  payment status=${confirmed.json.data.payment.status} entitlements=${confirmed.json.data.entitlements.length}`);

  const verify = await call("POST", "/v1/entitlements/verify", { customerId, productId });
  log("verify", verify);
  console.log(`  allowed=${verify.json.data.allowed}`);

  const session = await call("GET", `/v1/checkout-sessions/${sessionId}`);
  console.log(`  session status=${session.json.data.status}`);

  console.log("\nIDS", JSON.stringify({ productId, priceId, customerId, sessionId, paymentId }));
  console.log("SMOKE_OK");
}

main().catch((e) => { console.error("SMOKE_FAIL", e); process.exit(1); });
