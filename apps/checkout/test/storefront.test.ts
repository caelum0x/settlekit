import { afterEach, describe, expect, it, vi } from "vitest";
import { accent, getStorefront, priceLabel } from "../lib/storefront";

afterEach(() => vi.unstubAllGlobals());

describe("storefront helpers", () => {
  it("labels fiat and USD prices and sanitizes the accent colour", () => {
    const base = { name: "x", description: "", slug: "x-1", priceUsd: "29", displayCurrency: null, displayAmount: null, interval: "one_time" };
    expect(priceLabel(base)).toBe("$29");
    expect(priceLabel({ ...base, displayCurrency: "EUR", displayAmount: "27", interval: "monthly" })).toBe("27 EUR / month");
    expect(accent({ accentColor: "#ff5500" })).toBe("#ff5500");
    expect(accent({ accentColor: "red;background:url(x)" })).toBe("#1e40a2");
    expect(accent({ accentColor: null })).toBe("#1e40a2");
  });

  it("loads by slug or domain and returns null for unknown or malformed keys", async () => {
    process.env.SETTLEKIT_API_URL = "https://api.test";
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      if (url.endsWith("/missing-store")) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ data: { slug: "pixel-tools", title: "Pixel" } }), { status: 200 });
    });
    expect((await getStorefront({ slug: "pixel-tools" }))?.title).toBe("Pixel");
    expect(await getStorefront({ slug: "missing-store" })).toBeNull();
    expect(await getStorefront({ slug: "../admin" })).toBeNull();
    expect((await getStorefront({ domain: "Shop.Pixel.test" }))?.slug).toBe("pixel-tools");
    expect(urls).toEqual([
      "https://api.test/v1/public/stores/pixel-tools",
      "https://api.test/v1/public/stores/missing-store",
      "https://api.test/v1/public/stores/by-domain/shop.pixel.test",
    ]);
  });
});
