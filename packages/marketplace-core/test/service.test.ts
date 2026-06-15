import { describe, it, expect } from "vitest";
import { money, type MarketplaceListing } from "@settlekit/common";
import { InMemoryListingStore } from "../src/store.js";
import {
  MarketplaceService,
  type PriceResolver,
} from "../src/service.js";

function makeService(priceResolver?: PriceResolver) {
  const store = new InMemoryListingStore();
  return { store, service: new MarketplaceService(store, priceResolver) };
}

const baseInput = {
  organizationId: "org_1",
  merchantId: "mch_1",
  productId: "prod_1",
  title: "Starter Kit",
  summary: "Everything to get going",
  tags: ["starter"],
};

describe("MarketplaceService publish gating", () => {
  it("creates listings unpublished and excludes them from search", async () => {
    const { service } = makeService();
    const created = await service.createListing(baseInput);
    expect(created.published).toBe(false);

    const before = await service.search({ query: "starter" });
    expect(before).toHaveLength(0);
  });

  it("includes a listing in search only after publish", async () => {
    const { service } = makeService();
    const created = await service.createListing(baseInput);

    await service.publish(created.id);
    const afterPublish = await service.search({ query: "starter" });
    expect(afterPublish.map((l) => l.id)).toEqual([created.id]);

    await service.unpublish(created.id);
    const afterUnpublish = await service.search({ query: "starter" });
    expect(afterUnpublish).toHaveLength(0);
  });

  it("throws when publishing a missing listing", async () => {
    const { service } = makeService();
    await expect(service.publish("ml_missing")).rejects.toThrow();
  });

  it("persists rating aggregates across calls", async () => {
    const { service } = makeService();
    const created = await service.createListing(baseInput);
    await service.addRating(created.id, 5);
    const after = await service.addRating(created.id, 3);
    expect(after.ratingCount).toBe(2);
    expect(after.ratingAverage).toBe(4);

    const reloaded = await service.getListing(created.id);
    expect(reloaded?.ratingCount).toBe(2);
  });
});

describe("MarketplaceService price-sorted search", () => {
  it("resolves prices via the injected resolver", async () => {
    const prices = new Map<string, bigint>();
    const resolver: PriceResolver = {
      async priceBaseUnits(
        listing: MarketplaceListing,
      ): Promise<bigint | undefined> {
        return prices.get(listing.id);
      },
    };
    const { service } = makeService(resolver);

    const cheap = await service.createListing({
      ...baseInput,
      title: "Cheap Plan",
    });
    const pricey = await service.createListing({
      ...baseInput,
      title: "Pricey Plan",
    });
    prices.set(cheap.id, 1_000_000n);
    prices.set(pricey.id, 9_000_000n);
    await service.publish(cheap.id);
    await service.publish(pricey.id);

    const results = await service.search({ sort: "price" });
    expect(results.map((l) => l.id)).toEqual([cheap.id, pricey.id]);
  });
});

describe("MarketplaceService seller profile and fees", () => {
  it("aggregates a merchant's listings", async () => {
    const { service } = makeService();
    const a = await service.createListing(baseInput);
    const b = await service.createListing({ ...baseInput, title: "Second" });
    await service.publish(a.id);
    await service.addRating(a.id, 4); // count 1, avg 4
    await service.addRating(b.id, 2); // count 1, avg 2

    const profile = await service.sellerProfile("mch_1");
    expect(profile.totalListings).toBe(2);
    expect(profile.publishedListings).toBe(1);
    expect(profile.totalRatings).toBe(2);
    // weighted: (4*1 + 2*1) / 2 = 3
    expect(profile.ratingAverage).toBe(3);
  });

  it("exposes fee math", async () => {
    const { service } = makeService();
    expect(service.marketplaceFee(money("100"), 500).amount).toBe("5");
    const split = service.splitFee(money("100"), 1_000);
    expect(split.fee.amount).toBe("10");
    expect(split.net.amount).toBe("90");
  });
});
