import { isErr, isOk, money, unwrap } from "@settlekit/common";
import { describe, expect, it } from "vitest";
import {
  BundleService,
  InMemoryBundleStore,
  createBundle,
  validateBundle,
} from "../src/index.js";

const knownProducts = new Set(["prod_a", "prod_b"]);
const productExists = (id: string): boolean => knownProducts.has(id);

describe("validateBundle", () => {
  it("rejects empty bundles", () => {
    const bundle = createBundle({
      merchantId: "m",
      organizationId: "o",
      name: "Empty",
      productIds: [],
      price: money("0"),
    });
    const result = validateBundle({ bundle, productExists });
    expect(isErr(result)).toBe(true);
  });

  it("rejects self-references (cycles)", () => {
    const result = validateBundle({
      bundle: { id: "bndl_x", productIds: ["bndl_x"] },
      productExists: () => true,
    });
    expect(isErr(result)).toBe(true);
  });

  it("rejects duplicate products", () => {
    const result = validateBundle({
      bundle: { id: "bndl_x", productIds: ["prod_a", "prod_a"] },
      productExists,
    });
    expect(isErr(result)).toBe(true);
  });

  it("rejects unknown products", () => {
    const result = validateBundle({
      bundle: { id: "bndl_x", productIds: ["prod_a", "prod_missing"] },
      productExists,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe("not_found");
    }
  });

  it("accepts a valid bundle", () => {
    const result = validateBundle({
      bundle: { id: "bndl_x", productIds: ["prod_a", "prod_b"] },
      productExists,
    });
    expect(isOk(result)).toBe(true);
  });
});

describe("BundleService", () => {
  it("creates and persists a valid bundle", async () => {
    const store = new InMemoryBundleStore();
    const service = new BundleService(store, productExists);

    const result = await service.createBundle({
      merchantId: "mch_1",
      organizationId: "org_1",
      name: "Pro",
      productIds: ["prod_a", "prod_b"],
      memberPrices: [money("120"), money("80")],
    });

    expect(isOk(result)).toBe(true);
    const bundle = unwrap(result);
    expect(bundle.price).toEqual(money("200"));
    expect(await store.findById(bundle.id)).not.toBeNull();
  });

  it("does not persist an invalid bundle", async () => {
    const store = new InMemoryBundleStore();
    const service = new BundleService(store, productExists);

    const result = await service.createBundle({
      merchantId: "mch_1",
      organizationId: "org_1",
      name: "Bad",
      productIds: ["prod_a", "prod_missing"],
      price: money("10"),
    });

    expect(isErr(result)).toBe(true);
    expect(store.size).toBe(0);
  });

  it("builds a delivery plan for a stored bundle", async () => {
    const store = new InMemoryBundleStore();
    const service = new BundleService(store, productExists);
    const created = await service.createBundle({
      merchantId: "mch_1",
      organizationId: "org_1",
      name: "Pro",
      productIds: ["prod_a"],
      price: money("10"),
    });
    const bundle = unwrap(created);

    const planResult = await service.buildDeliveryPlan(bundle.id, [
      {
        product: {
          id: "prod_a",
          merchantId: "mch_1",
          organizationId: "org_1",
          name: "A",
          description: "",
          type: "github_repo_access",
          status: "active",
          deliveryMode: "github_invite",
          metadata: {},
          createdAt: "",
          updatedAt: "",
        },
        deliveryActions: [{ type: "github_invite", repoId: "repo_a" }],
      },
    ]);

    expect(isOk(planResult)).toBe(true);
    expect(unwrap(planResult).actions).toHaveLength(1);
  });

  it("returns not_found for an unknown bundle", async () => {
    const store = new InMemoryBundleStore();
    const service = new BundleService(store, productExists);
    const result = await service.getBundle("bndl_missing");
    expect(isErr(result)).toBe(true);
  });

  it("archives a stored bundle", async () => {
    const store = new InMemoryBundleStore();
    const service = new BundleService(store, productExists);
    const created = await service.createBundle({
      merchantId: "mch_1",
      organizationId: "org_1",
      name: "Pro",
      productIds: ["prod_a"],
      price: money("10"),
    });
    const bundle = unwrap(created);
    const archived = await service.archiveBundle(bundle.id);
    expect(unwrap(archived).status).toBe("archived");
  });
});
