/**
 * The Hono application: mounts every resource router under `/v1`, wires the
 * shared {@link AppContext} onto each request, and installs the error handler
 * that maps {@link SettleKitError} to the `{ error }` envelope with the right
 * HTTP status.
 *
 * `createApp(ctx?)` accepts an optional context so tests can inject a fresh,
 * isolated context per test; in production `server.ts` builds one at startup.
 */
import { Hono } from "hono";
import { SettleKitError } from "@settlekit/common";
import { ping } from "@settlekit/database";
import { type AppContext, type AppEnv } from "./context.js";
import { errorMiddleware } from "./middleware/error.js";
import { corsMiddleware, requestIdMiddleware, rateLimitMiddleware } from "./middleware/hardening.js";
import { loggingMiddleware } from "./middleware/logging.js";
import { metricsMiddleware, metricsRegistry } from "./middleware/metrics.js";
import { authMiddleware } from "./middleware/auth.js";
import { error } from "./http/respond.js";

import { productRoutes } from "./routes/products.js";
import { customerRoutes } from "./routes/customers.js";
import { checkoutRoutes } from "./routes/checkout-sessions.js";
import { paymentRoutes } from "./routes/payments.js";
import { subscriptionRoutes } from "./routes/subscriptions.js";
import { entitlementRoutes } from "./routes/entitlements.js";
import { apiKeyRoutes } from "./routes/api-keys.js";
import { licenseRoutes } from "./routes/license-keys.js";
import { fileRoutes } from "./routes/files.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { githubIntegrationRoutes, githubAccessRoutes } from "./routes/github.js";
import { discordIntegrationRoutes, discordAccessRoutes } from "./routes/discord.js";
import { saasRoutes } from "./routes/saas.js";
import { bundleRoutes } from "./routes/bundles.js";
import { deliveryRunRoutes, deliveryActionRoutes } from "./routes/delivery.js";
import { agentServiceRoutes } from "./routes/agent-services.js";
import { marketplaceRoutes } from "./routes/marketplace.js";
import { usageRoutes } from "./routes/usage.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { settingsRoutes } from "./routes/settings.js";
import { x402Routes } from "./routes/x402.js";
import { escrowRoutes } from "./routes/escrow.js";
import { couponRoutes } from "./routes/coupons.js";
import { invoiceRoutes } from "./routes/invoices.js";
import { refundRoutes } from "./routes/refunds.js";
import { dunningRoutes } from "./routes/dunning.js";
import { disputeRoutes } from "./routes/disputes.js";
import { payoutRoutes } from "./routes/payouts.js";
import { cctpRoutes } from "./routes/cctp.js";
import { gatewayRoutes } from "./routes/gateway.js";
import { fxRoutes } from "./routes/fx.js";
import { paymasterRoutes } from "./routes/paymaster.js";
import { mintRoutes } from "./routes/mint.js";
import { arcRoutes } from "./routes/arc.js";
import { circleWebhookRoutes } from "./routes/circle-webhooks.js";
import { userWalletRoutes } from "./routes/user-wallets.js";
import { onchainEscrowRoutes } from "./routes/onchain-escrow.js";
import { authRoutes } from "./routes/auth.js";
import { leptonRoutes } from "./routes/lepton.js";
import { fundRoutes } from "./routes/fund.js";

/** Build the full SettleKit API app. Pass a context to share/isolate state. */
export function createApp(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Centralized error mapping wraps the entire pipeline.
  app.use("*", errorMiddleware());

  // Production hardening: CORS (incl. preflight), request-id propagation, and a
  // per-instance rate limiter. CORS runs first so even rate-limited / errored
  // responses carry the right headers.
  app.use("*", corsMiddleware());
  app.use("*", requestIdMiddleware());
  app.use("*", metricsMiddleware());
  app.use("*", loggingMiddleware());
  app.use("*", rateLimitMiddleware());

  // Attach the shared context to every request.
  app.use("*", async (c, next) => {
    c.set("ctx", ctx);
    await next();
  });

  // Liveness probe (unauthenticated): the process is up and serving.
  app.get("/health", (c) => c.json({ data: { status: "ok", service: "settlekit-api" } }));

  // Prometheus metrics (unauthenticated, for scraping). Text exposition format.
  app.get("/metrics", (c) => {
    return c.body(metricsRegistry.render(), 200, { "Content-Type": "text/plain; version=0.0.4" });
  });

  // Readiness probe: the process can serve traffic. In Postgres mode this pings
  // the database (503 if unreachable); in-memory mode is always ready.
  app.get("/health/ready", async (c) => {
    const ctx = c.get("ctx");
    if (!ctx.db) {
      return c.json({ data: { ready: true, persistence: "in-memory" } });
    }
    const ok = await ping(ctx.db);
    return c.json(
      { data: { ready: ok, persistence: "postgres", database: ok ? "connected" : "unreachable" } },
      ok ? 200 : 503,
    );
  });

  // Authentication is PUBLIC: no API key. Mounted before/outside the v1
  // api-key-guarded group so sign-up/sign-in work without an existing key.
  app.route("/v1/auth", authRoutes());

  // x402 paid APIs are PUBLIC: the USDC payment IS the authorization, so these
  // are mounted outside the API-key guard (humans + AI agents pay per call).
  app.route("/v1/paid", x402Routes());

  // Lepton hackathon demo is PUBLIC: self-contained, in-memory nanopayment
  // modules (agent economy, citation tolls, streaming). No API key, no DB.
  app.route("/v1/lepton", leptonRoutes());

  // OSS maintainer funding is PUBLIC: turn a dependency manifest into a
  // conserved, signal-weighted distribution across maintainer wallets, settled
  // in-memory. No API key, no DB.
  app.route("/v1/fund", fundRoutes());

  // Inbound Circle webhooks are PUBLIC: authenticated by Circle's ECDSA
  // signature (verified in the handler), not an API key. Mounted outside the
  // v1 api-key guard. POST /v1/circle/webhooks.
  app.route("/v1/circle", circleWebhookRoutes());

  // Everything else under /v1 requires a valid Bearer API key.
  const v1 = new Hono<AppEnv>();
  v1.use("*", authMiddleware());

  // ---- Core commerce -----------------------------------------------------
  v1.route("/products", productRoutes());
  v1.route("/customers", customerRoutes());
  v1.route("/checkout-sessions", checkoutRoutes());
  v1.route("/payments", paymentRoutes());
  v1.route("/subscriptions", subscriptionRoutes());
  v1.route("/entitlements", entitlementRoutes());
  v1.route("/api-keys", apiKeyRoutes());
  v1.route("/license-keys", licenseRoutes());
  v1.route("/files", fileRoutes());
  v1.route("/webhooks", webhookRoutes());

  // ---- GitHub (plan §26) -------------------------------------------------
  v1.route("/integrations/github", githubIntegrationRoutes());
  v1.route("/github/access", githubAccessRoutes());

  // ---- Discord (plan §26) ------------------------------------------------
  v1.route("/integrations/discord", discordIntegrationRoutes());
  v1.route("/discord/access", discordAccessRoutes());

  // ---- SaaS (plan §26) ---------------------------------------------------
  v1.route("/saas", saasRoutes());

  // ---- Bundles (plan §26) ------------------------------------------------
  v1.route("/bundles", bundleRoutes());

  // ---- Delivery (plan §26) -----------------------------------------------
  v1.route("/delivery-runs", deliveryRunRoutes());
  v1.route("/delivery-actions", deliveryActionRoutes());

  // ---- Agent services (plan §26) -----------------------------------------
  v1.route("/agent-services", agentServiceRoutes());

  // ---- Marketplace (plan §11) --------------------------------------------
  v1.route("/marketplace", marketplaceRoutes());

  // ---- Usage-based billing (plan §5, §31) --------------------------------
  v1.route("/usage", usageRoutes());

  // ---- Analytics (merchant dashboard summary) ----------------------------
  v1.route("/analytics", analyticsRoutes());

  // ---- Onboarding (merchant activation funnel) ---------------------------
  v1.route("/onboarding", onboardingRoutes());

  // ---- Organization settings ---------------------------------------------
  v1.route("/settings", settingsRoutes());

  // ---- Escrow (plan §26) -------------------------------------------------
  v1.route("/escrow", escrowRoutes());

  // ---- Commerce engines: coupons + invoices ------------------------------
  v1.route("/coupons", couponRoutes());
  v1.route("/invoices", invoiceRoutes());

  // ---- Commerce engines: refunds, dunning, disputes, payouts -------------
  v1.route("/refunds", refundRoutes());
  v1.route("/dunning", dunningRoutes());
  v1.route("/disputes", disputeRoutes());
  v1.route("/payouts", payoutRoutes());
  v1.route("/arc", arcRoutes());
  v1.route("/cctp", cctpRoutes());
  v1.route("/gateway", gatewayRoutes());
  v1.route("/fx", fxRoutes());
  v1.route("/mint", mintRoutes());
  v1.route("/user-wallets", userWalletRoutes());
  v1.route("/onchain-escrow", onchainEscrowRoutes());
  // paymaster + gas-station share one router (paths are /paymaster/* and /gas-station/*).
  v1.route("/", paymasterRoutes());

  app.route("/v1", v1);

  // Fallbacks: uniform 404 + error envelopes even outside route handlers.
  app.notFound((c) =>
    error(c, new SettleKitError({ code: "not_found", message: `No route for ${c.req.method} ${c.req.path}` })),
  );
  app.onError((err, c) => error(c, err));

  return app;
}
