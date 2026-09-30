/** Hosted storefront: settings validation and the public store view. */
import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import { createContext, type AppContext, type AppEnv } from "../src/context.js";

const BOOTSTRAP = "test-bootstrap-key";
let app: Hono<AppEnv>;
let ctx: AppContext;
let otherKey: string;

async function call(method: string, path: string, body?: unknown, key: string | null = BOOTSTRAP) {
  const res = await app.request(path, {
    method,
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as { data?: any; error?: { message: string } } };
}

beforeEach(async () => {
  process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
  ctx = await createContext();
  app = createApp(ctx);
  otherKey = (
    await ctx.apiKeys.issue({ organizationId: "org_other", customerId: "x", productId: "__platform__", entitlementId: "__platform__", scopes: ["*"], env: "live" })
  ).plaintext;
  await call("POST", "/v1/merchant/profile", { orgName: "Pixel Tools", acceptedNetworks: ["base"], addresses: { evm: "0x9191919191919191919191919191919191919191" } });
});

const STORE = {
  enabled: true,
  slug: "pixel-tools",
  title: "Pixel Tools",
  tagline: "Icons and UI kits",
  logoUrl: "https://cdn.pixel.test/logo.png",
  accentColor: "#ff5500",
  seoDescription: "Icon packs and UI kits paid in USDC.",
  customDomain: "shop.pixel.test",
};

describe("hosted storefront", () => {
  it("lists active products with branding by slug and custom domain", async () => {
    expect((await call("POST", "/v1/settings", { store: STORE })).status).toBe(200);
    await call("POST", "/v1/merchant/products", { name: "Icon pack", description: "2,000 icons", priceUsd: "29", delivery: { kind: "license_key", machineLimit: 1 } });
    const archived = await call("POST", "/v1/merchant/products", { name: "Old", priceUsd: "5", delivery: { kind: "license_key", machineLimit: 1 } });
    await call("PATCH", `/v1/merchant/products/${archived.json.data.id}`, { status: "archived" });
    // A sent invoice creates a hidden product that must not appear.
    await call("POST", "/v1/invoices/requests", { amount: "50", description: "Custom work", payerEmail: "c@x.test" });

    const store = await call("GET", "/v1/public/stores/pixel-tools", undefined, null);
    expect(store.status).toBe(200);
    expect(store.json.data).toMatchObject({
      title: "Pixel Tools",
      tagline: "Icons and UI kits",
      accentColor: "#ff5500",
      merchantName: "Pixel Tools",
      acceptingPayments: true,
    });
    const names = store.json.data.products.map((p: { name: string }) => p.name);
    expect(names).toContain("Icon pack");
    expect(names).not.toContain("Old");
    expect(names.some((n: string) => n.startsWith("Invoice"))).toBe(false);
    expect(store.json.data.products[0].slug).toMatch(/^icon-pack-/);

    const byDomain = await call("GET", "/v1/public/stores/by-domain/shop.pixel.test", undefined, null);
    expect(byDomain.json.data.slug).toBe("pixel-tools");
  });

  it("keeps slugs and domains unique and validates branding", async () => {
    await call("POST", "/v1/settings", { store: STORE });
    expect((await call("POST", "/v1/settings", { store: { ...STORE, customDomain: undefined } }, otherKey)).status).toBe(409);
    expect((await call("POST", "/v1/settings", { store: { ...STORE, slug: "other-shop" } }, otherKey)).status).toBe(409);
    expect((await call("POST", "/v1/settings", { store: { enabled: true, slug: "api" } }, otherKey)).status).toBe(400);
    expect((await call("POST", "/v1/settings", { store: { enabled: true, slug: "ok-shop", logoUrl: "http://insecure.test/x.png" } }, otherKey)).status).toBe(400);
    expect((await call("POST", "/v1/settings", { store: { enabled: true, slug: "ok-shop", accentColor: "red" } }, otherKey)).status).toBe(400);
    expect((await call("POST", "/v1/settings", { store: { enabled: true, slug: "ok-shop" } }, otherKey)).status).toBe(200);
  });

  it("hides a disabled or unknown store", async () => {
    await call("POST", "/v1/settings", { store: { ...STORE, enabled: false } });
    expect((await call("GET", "/v1/public/stores/pixel-tools", undefined, null)).status).toBe(404);
    expect((await call("GET", "/v1/public/stores/nope-nope", undefined, null)).status).toBe(404);
  });
});
