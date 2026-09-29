import { describe, expect, it } from "vitest";
import {
  COINBASE_ZEC_SPOT_URL,
  KRAKEN_ZEC_TICKER_URL,
  createCoinbaseSource,
  createKrakenSource,
  lockQuote,
  usdToZats,
  type PriceSource,
} from "../src/index.js";
import { fixture, routedFetch } from "./fakes.js";

const NOW = new Date("2026-09-29T12:00:00.000Z");
const clock = () => NOW;

function fixed(name: string, rate: string, observedAt = NOW): PriceSource {
  return { name, fetchUsdPrice: async () => ({ rate, source: name, observedAt }) };
}

function failing(name: string): PriceSource {
  return { name, fetchUsdPrice: async () => Promise.reject(new Error(`${name} down`)) };
}

describe("price sources (recorded responses)", () => {
  it("parses Coinbase spot and Kraken ticker", async () => {
    const fetch = routedFetch({
      [COINBASE_ZEC_SPOT_URL]: { body: fixture("coinbase-spot.json") },
      [KRAKEN_ZEC_TICKER_URL]: { body: fixture("kraken-ticker.json") },
    });
    await expect(createCoinbaseSource(fetch, clock).fetchUsdPrice()).resolves.toEqual({
      rate: "1438.25",
      source: "coinbase",
      observedAt: NOW,
    });
    await expect(createKrakenSource(fetch, clock).fetchUsdPrice()).resolves.toMatchObject({ rate: "1439.25000" });
  });

  it("rejects HTTP errors, wrong pairs and non-numeric prices", async () => {
    const down = routedFetch({ [COINBASE_ZEC_SPOT_URL]: { status: 503 } });
    await expect(createCoinbaseSource(down).fetchUsdPrice()).rejects.toThrow(/HTTP 503/);
    const wrongPair = routedFetch({ [COINBASE_ZEC_SPOT_URL]: { body: { data: { amount: "1", base: "BTC", currency: "USD" } } } });
    await expect(createCoinbaseSource(wrongPair).fetchUsdPrice()).rejects.toThrow(/unexpected pair/);
    const krakenErr = routedFetch({ [KRAKEN_ZEC_TICKER_URL]: { body: { error: ["EQuery:Unknown asset pair"] } } });
    await expect(createKrakenSource(krakenErr).fetchUsdPrice()).rejects.toThrow(/Unknown asset pair/);
    const zero = routedFetch({ [COINBASE_ZEC_SPOT_URL]: { body: { data: { amount: "0", base: "ZEC", currency: "USD" } } } });
    await expect(createCoinbaseSource(zero).fetchUsdPrice()).rejects.toThrow(/invalid ZEC price/);
  });
});

describe("usdToZats", () => {
  it("rounds up to the next zatoshi", () => {
    expect(usdToZats("25", "1438.25")).toBe(1_738_224n); // 25 / 1438.25 = 0.017382235…
    expect(usdToZats("10", "10")).toBe(100_000_000n);
    expect(usdToZats("0.000001", "3")).toBe(34n);
  });
});

describe("lockQuote", () => {
  it("locks primary rate + tag with a 15 minute TTL", async () => {
    const quote = await lockQuote({
      usdAmount: "25",
      tag: 42,
      sources: [fixed("coinbase", "1438.25"), fixed("kraken", "1439.25")],
      now: NOW,
    });
    expect(quote).toEqual({
      asset: "ZEC",
      amountBase: String(1_738_224n + 42n),
      decimals: 8,
      rate: "1438.25",
      source: "coinbase",
      lockedAt: "2026-09-29T12:00:00.000Z",
      expiresAt: "2026-09-29T12:15:00.000Z",
    });
  });

  it("falls back to Kraken when Coinbase fails", async () => {
    const quote = await lockQuote({ usdAmount: "25", tag: 0, sources: [failing("coinbase"), fixed("kraken", "1439.25")], now: NOW });
    expect(quote.source).toBe("kraken");
  });

  it("rejects >3% divergence between sources", async () => {
    await expect(
      lockQuote({ usdAmount: "25", tag: 0, sources: [fixed("coinbase", "1000"), fixed("kraken", "1031")], now: NOW }),
    ).rejects.toThrow(/disagree/);
    await expect(
      lockQuote({ usdAmount: "25", tag: 0, sources: [fixed("coinbase", "1000"), fixed("kraken", "1030")], now: NOW }),
    ).resolves.toMatchObject({ rate: "1000" });
  });

  it("rejects stale observations and total source failure", async () => {
    const old = new Date(NOW.getTime() - 61_000);
    await expect(lockQuote({ usdAmount: "25", tag: 0, sources: [fixed("coinbase", "1000", old)], now: NOW })).rejects.toThrow(/stale/);
    await expect(lockQuote({ usdAmount: "25", tag: 0, sources: [failing("a"), failing("b")], now: NOW })).rejects.toThrow(/all ZEC price sources failed/);
    await expect(lockQuote({ usdAmount: "25", tag: 0, sources: [], now: NOW })).rejects.toThrow(/no ZEC price sources/);
  });

  it("honours a custom TTL", async () => {
    const quote = await lockQuote({ usdAmount: "1", tag: 0, sources: [fixed("coinbase", "1")], now: NOW, ttlSec: 60 });
    expect(quote.expiresAt).toBe("2026-09-29T12:01:00.000Z");
  });
});
