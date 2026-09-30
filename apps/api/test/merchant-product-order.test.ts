/**
 * Postgres enforces prices.product_id -> products.id, so a quick product must
 * be stored before its price. The in-memory repositories do not enforce the
 * foreign key, so this test wraps the price repository to reject a price whose
 * product does not exist yet (as Postgres does).
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import { createContext, type AppContext, type AppEnv } from "../src/context.js";

const BOOTSTRAP = "test-bootstrap-key";

let app: Hono<AppEnv>;

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { authorization: `Bearer ${BOOTSTRAP}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as { data?: any; error?: { code: string; message: string } } };
}

beforeEach(async () => {
  process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
  const base = await createContext();
  const prices = base.prices;
  const fkPrices = new Proxy(prices, {
    get(target, prop, receiver) {
      if (prop === "save") {
        return async (price: { productId: string }) => {
          if (!(await base.products.findById(price.productId))) {
            throw new Error(`foreign key violation: product ${price.productId} does not exist`);
          }
          return target.save(price as never);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  const ctx: AppContext = { ...base, prices: fkPrices };
  app = createApp(ctx);
});

describe("merchant quick product", () => {
  it("stores the product before its price and publishes it", async () => {
    expect(
      (
        await call("POST", "/v1/merchant/profile", {
          orgName: "Shop",
          acceptedNetworks: ["base"],
          addresses: { evm: "0x7777777777777777777777777777777777777777" },
        })
      ).status,
    ).toBe(200);
    const product = await call("POST", "/v1/merchant/products", {
      name: "Pass",
      priceUsd: "1",
      delivery: { kind: "license_key", machineLimit: 1 },
    });
    expect(product.status, JSON.stringify(product.json.error)).toBe(201);
    expect(product.json.data.status).toBe("active");
    expect(typeof product.json.data.slug).toBe("string");
  });
});
