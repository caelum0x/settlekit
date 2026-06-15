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
import { type AppContext, type AppEnv } from "./context.js";
import { errorMiddleware } from "./middleware/error.js";
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
import { escrowRoutes } from "./routes/escrow.js";
import { couponRoutes } from "./routes/coupons.js";
import { invoiceRoutes } from "./routes/invoices.js";
import { authRoutes } from "./routes/auth.js";

/** Build the full SettleKit API app. Pass a context to share/isolate state. */
export function createApp(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Centralized error mapping wraps the entire pipeline.
  app.use("*", errorMiddleware());

  // Attach the shared context to every request.
  app.use("*", async (c, next) => {
    c.set("ctx", ctx);
    await next();
  });

  // Liveness probe (unauthenticated).
  app.get("/health", (c) => c.json({ data: { status: "ok", service: "settlekit-api" } }));

  // Authentication is PUBLIC: no API key. Mounted before/outside the v1
  // api-key-guarded group so sign-up/sign-in work without an existing key.
  app.route("/v1/auth", authRoutes());

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

  // ---- Escrow (plan §26) -------------------------------------------------
  v1.route("/escrow", escrowRoutes());

  // ---- Commerce engines: coupons + invoices ------------------------------
  v1.route("/coupons", couponRoutes());
  v1.route("/invoices", invoiceRoutes());

  app.route("/v1", v1);

  // Fallbacks: uniform 404 + error envelopes even outside route handlers.
  app.notFound((c) =>
    error(c, new SettleKitError({ code: "not_found", message: `No route for ${c.req.method} ${c.req.path}` })),
  );
  app.onError((err, c) => error(c, err));

  return app;
}
