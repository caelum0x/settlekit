import { describe, expect, it } from "vitest";
import type { CheckoutRoute } from "@settlekit/common";
import {
  applyRouteStatus,
  checkOrigin,
  createLifiProvider,
  createRelayProvider,
  createRouter,
  createRouterFromConfig,
  DEFAULT_ROUTE_POLICY,
  evaluateQuote,
  feeBpsOf,
  findOrigin,
  isRouteTerminal,
  loadRoutingConfig,
  parseOriginAllowlist,
  parseRelayQuote,
  parseRelayStatus,
  quoteExpiresAt,
  routeDestinationFor,
  routeFromQuote,
  toDestinationUnits,
  type RoutePolicy,
  type RouteQuote,
} from "../src/index.js";
import { fixture, replayFetch } from "./replay.js";
import { ARB_USDC, baseRequest, destination, RECIPIENT, SOL_RECIPIENT, USER } from "./requests.js";

const relayQuote = (): RouteQuote => parseRelayQuote(fixture("relay", "quote-arb-usdc-to-base"));

describe("destination map", () => {
  it.each([
    ["base", 8453, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", 6],
    ["arbitrum", 42161, "0xaf88d065e77c8cc2239327c5edb3a432268e5831", 6],
    ["ethereum", 1, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 6],
    ["hyperevm", 999, "0xb88339cb7199b77e23db6e890353e22632ba630f", 6],
    ["robinhood", 4663, "0x5fc5360d0400a0fd4f2af552add042d716f1d168", 6],
    ["tempo", 4217, "0x20c000000000000000000000b9537d11c60e8b50", 6],
    ["solana", 792703809, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 6],
    ["hypercore", 1337, "0x00000000000000000000000000000000", 8],
  ] as const)("%s → chain %i token %s", (network, chainId, token, decimals) => {
    expect(destination(network)).toMatchObject({ network, chainId, token, decimals });
  });

  it("routes Tempo to pathUSD only when the verifier checks pathUSD", () => {
    const pathUsd = routeDestinationFor("tempo", { env: "mainnet", tokenAddress: "0x20C0000000000000000000000000000000000000" });
    expect(pathUsd).toMatchObject({ ok: true, destination: { symbol: "pathUSD" } });
    expect(routeDestinationFor("tempo", { env: "mainnet", tokenAddress: "0x1111111111111111111111111111111111111111" }).ok).toBe(false);
    expect(routeDestinationFor("base", { env: "mainnet", tokenAddress: "0x1111111111111111111111111111111111111111" }).ok).toBe(false);
  });

  it("is mainnet only and never routes to Arc or Zcash", () => {
    expect(routeDestinationFor("base", { env: "testnet" })).toMatchObject({ ok: false, reason: expect.stringMatching(/mainnet/) });
    expect(routeDestinationFor("arc", { env: "mainnet" }).ok).toBe(false);
    expect(routeDestinationFor("zcash", { env: "mainnet" }).ok).toBe(false);
  });

  it("converts session units, never rounding against the merchant", () => {
    expect(toDestinationUnits(25_000_000n, 8)).toBe(2_500_000_000n);
    expect(toDestinationUnits(25_000_000n, 6)).toBe(25_000_000n);
    expect(toDestinationUnits(1_000_001n, 2)).toBe(101n);
  });
});

describe("routing policy", () => {
  const policy: RoutePolicy = { ...DEFAULT_ROUTE_POLICY };
  const request = baseRequest();

  it("accepts the recorded Relay quote", () => {
    expect(evaluateQuote(policy, request, relayQuote())).toEqual({ ok: true });
  });

  it.each<[string, (quote: RouteQuote) => RouteQuote, Partial<RoutePolicy>, RegExp]>([
    ["wrong destination chain", (q) => ({ ...q, destination: { ...q.destination, chainId: 10 } }), {}, /chain 10/],
    ["wrong destination token", (q) => ({ ...q, destination: { ...q.destination, token: "0xdead" } }), {}, /delivers 0xdead/],
    ["different recipient", (q) => ({ ...q, recipient: USER }), {}, /recipient/],
    ["different origin token", (q) => ({ ...q, origin: { ...q.origin, token: "0x0000000000000000000000000000000000000000" } }), {}, /origin token/],
    ["guaranteed amount below owed", (q) => ({ ...q, destination: { ...q.destination, minimumAmount: "4999999" } }), {}, /4999999/],
    ["unreadable minimum", (q) => ({ ...q, destination: { ...q.destination, minimumAmount: "n/a" } }), {}, /guaranteed/],
    ["unpriced", (q) => ({ ...q, feeBps: null }), {}, /priced/],
    ["fee above limit", (q) => q, { maxFeeBps: 50 }, /0\.55%.*0\.50%/],
    ["slippage above limit", (q) => ({ ...q, slippageBps: 250 }), {}, /250 bps/],
    ["deposit mode without address", (q) => q, {}, /deposit address/],
  ])("rejects: %s", (label, mutate, override, reason) => {
    const req = label === "deposit mode without address" ? { ...request, depositAddress: true } : request;
    const verdict = evaluateQuote({ ...policy, ...override }, req, mutate(relayQuote()));
    expect(verdict).toMatchObject({ ok: false, reason: expect.stringMatching(reason) });
  });

  it("rejects the HyperCore route's fixed bridge cost under the default 3% cap", () => {
    const quote = parseRelayQuote(fixture("relay", "quote-base-usdc-to-hypercore"));
    const req = baseRequest({ destination: destination("hypercore"), amountBase: 25_000_000n, origin: { chainId: 8453, token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" } });
    expect(evaluateQuote(policy, req, quote)).toMatchObject({ ok: false, reason: expect.stringMatching(/above the 3\.00% limit/) });
    expect(evaluateQuote({ ...policy, maxFeeBps: 600 }, req, quote)).toEqual({ ok: true });
  });

  it("checks origins against the offer list and allowlist", () => {
    expect(checkOrigin(policy, { chainId: 42161, token: ARB_USDC.toUpperCase().replace("0X", "0x") })).toEqual({ ok: true });
    expect(checkOrigin(policy, { chainId: 42161, token: "0x1111111111111111111111111111111111111111" }).ok).toBe(false);
    expect(checkOrigin(policy, { chainId: 7777, token: "0x0000000000000000000000000000000000000000" }).ok).toBe(false);
    const narrow: RoutePolicy = { ...policy, origins: [{ chainId: 8453, tokens: "*" }, { chainId: 42161, tokens: [ARB_USDC] }] };
    expect(checkOrigin(narrow, { chainId: 8453, token: "0x0000000000000000000000000000000000000000" })).toEqual({ ok: true });
    expect(checkOrigin(narrow, { chainId: 42161, token: ARB_USDC })).toEqual({ ok: true });
    expect(checkOrigin(narrow, { chainId: 42161, token: "0x0000000000000000000000000000000000000000" }).ok).toBe(false);
    expect(checkOrigin(narrow, { chainId: 1, token: "0x0000000000000000000000000000000000000000" }).ok).toBe(false);
    expect(findOrigin(792703809, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")?.token.symbol).toBe("USDC");
    expect(findOrigin(792703809, "epjfwdd5aufqssqem2qn1xzybapc8g4wegGkZwyTDt1v")).toBeUndefined();
  });

  it("computes fee bps and quote expiry", () => {
    expect(feeBpsOf("5.05", "5")).toBe(100);
    expect(feeBpsOf("4.9", "5")).toBe(0);
    expect(feeBpsOf(null, "5")).toBeNull();
    expect(feeBpsOf("1", "0")).toBeNull();
    expect(quoteExpiresAt(policy, new Date("2026-09-29T00:00:00Z")).toISOString()).toBe("2026-09-29T00:02:00.000Z");
  });
});

describe("router: Relay first, LI.FI fallback", () => {
  const relayOk = { match: (url: string) => url === "https://api.relay.link/quote", body: fixture("relay", "quote-arb-usdc-to-base") };
  const lifiOk = { match: (url: string) => url.includes("li.quest"), body: fixture("lifi", "quote-arb-usdc-to-base") };

  function router(routes: Parameters<typeof replayFetch>[0], policy: RoutePolicy = DEFAULT_ROUTE_POLICY) {
    const fetchImpl = replayFetch(routes);
    return { fetchImpl, router: createRouter([createRelayProvider({ fetch: fetchImpl }), createLifiProvider({ fetch: fetchImpl })], policy) };
  }

  it("returns Relay's quote when it passes the policy, and passes the slippage cap", async () => {
    const { router: r, fetchImpl } = router([relayOk, lifiOk]);
    expect((await r.quote(baseRequest())).provider).toBe("relay");
    expect(fetchImpl.calls).toHaveLength(1);
    expect(fetchImpl.calls[0]!.body).toMatchObject({ slippageTolerance: "100" });
  });

  it("falls back to LI.FI when Relay refuses", async () => {
    const { router: r } = router([{ ...relayOk, status: 400, body: fixture("relay", "quote-invalid-amount") }, lifiOk]);
    expect((await r.quote(baseRequest())).provider).toBe("lifi");
  });

  it("falls back to LI.FI when Relay's quote breaks the policy", async () => {
    const recorded = fixture("relay", "quote-arb-usdc-to-base") as { details: Record<string, unknown> };
    const wideSlippage = { ...recorded, details: { ...recorded.details, slippageTolerance: { total: "150" } } };
    const { router: r } = router([{ ...relayOk, body: wideSlippage }, lifiOk]);
    expect((await r.quote(baseRequest())).provider).toBe("lifi");
  });

  it("reports no_route with every provider's reason", async () => {
    const { router: r } = router([
      { ...relayOk, status: 400, body: fixture("relay", "quote-blocked") },
      { ...lifiOk, status: 404, body: fixture("lifi", "quote-error") },
    ]);
    await expect(r.quote(baseRequest())).rejects.toMatchObject({
      code: "no_route",
      message: expect.stringMatching(/relay: .*blocked.*; lifi: .*Could not find token/),
    });
  });

  it("uses only Relay for HyperCore and deposit addresses (its own error surfaces)", async () => {
    const { router: r } = router([{ ...relayOk, status: 400, body: fixture("relay", "quote-invalid-amount") }]);
    await expect(r.quote(baseRequest({ depositAddress: true }))).rejects.toMatchObject({ code: "provider_rejected", providerCode: "AMOUNT_TOO_LOW" });
  });

  it("refuses origins outside the policy before calling any provider", async () => {
    const { router: r, fetchImpl } = router([relayOk]);
    await expect(r.quote(baseRequest({ origin: { chainId: 42161, token: "0x1111111111111111111111111111111111111111" } }))).rejects.toMatchObject({
      code: "policy_violation",
    });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it("asks the issuing provider for status with its own destination chain id", async () => {
    const { router: r, fetchImpl } = router([
      { match: (url) => url.includes("intents/status"), body: fixture("relay", "status-success") },
      { match: (url) => url.includes("li.quest/v1/status"), body: fixture("lifi", "status-done") },
    ]);
    const sol = destination("solana");
    expect((await r.status({ provider: "relay", requestId: "0x1", originChainId: 1, destination: sol })).state).toBe("success");
    await r.status({ provider: "lifi", requestId: "q", originChainId: 1, destination: sol, originTxHash: "0xabc" });
    expect(fetchImpl.calls.at(-1)!.url).toContain("toChain=1151111081099710");
  });
});

describe("session route record", () => {
  const quote = relayQuote();
  const request = baseRequest();
  const quotedAt = new Date("2026-09-29T12:00:00Z");
  const route: CheckoutRoute = routeFromQuote(quote, request, "base", quotedAt, quoteExpiresAt(DEFAULT_ROUTE_POLICY, quotedAt));

  it("records provider, request id, origin and expiry", () => {
    expect(route).toMatchObject({
      provider: "relay",
      requestId: quote.requestId,
      network: "base",
      originChainId: 42161,
      originToken: ARB_USDC,
      originAmount: "5027158",
      originAddress: USER,
      state: "quoted",
      expiresAt: "2026-09-29T12:02:00.000Z",
    });
  });

  it("advances with provider status and stores the destination fill", () => {
    const later = new Date("2026-09-29T12:01:00Z");
    const pending = applyRouteStatus(route, parseRelayStatus({ status: "pending", inTxHashes: ["0xin"] }), later);
    expect(pending).toMatchObject({ state: "pending", originTxHash: "0xin" });
    const success = applyRouteStatus(pending, parseRelayStatus(fixture("relay", "status-success")), later);
    expect(success).toMatchObject({
      state: "success",
      originTxHash: "0xin",
      destinationTxHash: "0x1200b58d252579a000bb547ad271ef14f83ddbf08a2214ad8a8058188725fb8b",
    });
    expect(isRouteTerminal(success)).toBe(true);
    // Terminal states never regress, and unknown never overwrites.
    expect(applyRouteStatus(success, parseRelayStatus({ status: "waiting" }), later)).toBe(success);
    expect(applyRouteStatus(route, parseRelayStatus(fixture("relay", "status-unknown")), later)).toBe(route);
  });

  it("stores refund legs and failure details", () => {
    const refunded = applyRouteStatus(route, parseRelayStatus(fixture("relay", "status-refund")), quotedAt);
    expect(refunded).toMatchObject({ state: "refund", refundTxHash: expect.any(String), detail: "DESTINATION_TOKEN_TRANSFER_REJECTED" });
    expect(refunded.destinationTxHash).toBeUndefined();
    expect(applyRouteStatus(route, parseRelayStatus(fixture("relay", "status-failure")), quotedAt)).toMatchObject({ state: "failure" });
  });
});

describe("loadRoutingConfig", () => {
  it("is off unless ROUTING_ENABLED", () => {
    expect(loadRoutingConfig({})).toBeNull();
  });

  it("reads providers, policy and app fee", () => {
    const config = loadRoutingConfig({
      ROUTING_ENABLED: "true",
      RELAY_API_KEY: "rk",
      LIFI_ENABLED: "false",
      ROUTE_MAX_FEE_BPS: "150",
      ROUTE_MAX_SLIPPAGE_BPS: "50",
      ROUTE_QUOTE_TTL_SEC: "60",
      ROUTE_ORIGIN_ALLOWLIST: `8453:*,42161:${ARB_USDC}|0x0000000000000000000000000000000000000000`,
      ROUTE_APP_FEE_BPS: "25",
      ROUTE_APP_FEE_RECIPIENT: RECIPIENT,
    });
    expect(config).toEqual({
      relay: { baseUrl: "https://api.relay.link", apiKey: "rk" },
      lifi: null,
      policy: {
        maxFeeBps: 150,
        maxSlippageBps: 50,
        quoteTtlSec: 60,
        origins: [
          { chainId: 8453, tokens: "*" },
          { chainId: 42161, tokens: [ARB_USDC, "0x0000000000000000000000000000000000000000"] },
        ],
      },
      appFee: { recipient: RECIPIENT, bps: 25 },
    });
    expect(createRouterFromConfig(config!).providers.map((provider) => provider.name)).toEqual(["relay"]);
    expect(createRouterFromConfig(loadRoutingConfig({ ROUTING_ENABLED: "1" })!).providers.map((p) => p.name)).toEqual(["relay", "lifi"]);
  });

  it("refuses bad values", () => {
    expect(() => loadRoutingConfig({ ROUTING_ENABLED: "yes please" })).toThrow(/ROUTING_ENABLED/);
    expect(() => loadRoutingConfig({ ROUTING_ENABLED: "1", ROUTE_MAX_FEE_BPS: "5000" })).toThrow(/ROUTE_MAX_FEE_BPS/);
    expect(() => loadRoutingConfig({ ROUTING_ENABLED: "1", ROUTE_APP_FEE_BPS: "10" })).toThrow(/RECIPIENT/);
    expect(() => loadRoutingConfig({ ROUTING_ENABLED: "1", RELAY_API_URL: "ftp://x" })).toThrow(/RELAY_API_URL/);
    expect(() => parseOriginAllowlist("base:*")).toThrow(/ROUTE_ORIGIN_ALLOWLIST/);
    expect(parseOriginAllowlist(" * ")).toBe("*");
  });

  it("keeps the Solana recipient verbatim (base58 is case-sensitive)", () => {
    const quote = parseRelayQuote(fixture("relay", "quote-eth-native-to-solana-usdc"));
    const req = baseRequest({ destination: destination("solana"), recipient: SOL_RECIPIENT, origin: { chainId: 1, token: "0x0000000000000000000000000000000000000000" } });
    expect(evaluateQuote(DEFAULT_ROUTE_POLICY, req, quote)).toEqual({ ok: true });
    expect(evaluateQuote(DEFAULT_ROUTE_POLICY, { ...req, recipient: SOL_RECIPIENT.toLowerCase() }, quote).ok).toBe(false);
  });
});
