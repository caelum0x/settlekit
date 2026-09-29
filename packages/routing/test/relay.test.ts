import { describe, expect, it } from "vitest";
import { buildRelayQuoteBody, createRelayProvider, parseRelayQuote, parseRelayStatus, RouteError } from "../src/index.js";
import { fixture, replayFetch } from "./replay.js";
import { ARB_USDC, baseRequest, destination, RECIPIENT, SOL_RECIPIENT, USER } from "./requests.js";

describe("Relay quote request", () => {
  it("asks for EXACT_OUTPUT to the merchant with the buyer as refund address", () => {
    expect(buildRelayQuoteBody(baseRequest({ slippageBps: 100 }))).toEqual({
      user: USER,
      recipient: RECIPIENT,
      originChainId: 42161,
      destinationChainId: 8453,
      originCurrency: ARB_USDC,
      destinationCurrency: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      amount: "5000000",
      tradeType: "EXACT_OUTPUT",
      refundTo: USER,
      slippageTolerance: "100",
    });
  });

  it("adds strict deposit-address mode, app fees and the referrer", () => {
    const body = buildRelayQuoteBody(
      baseRequest({ depositAddress: true, appFee: { recipient: USER, bps: 50 } }),
      "settlekit",
    );
    expect(body).toMatchObject({ useDepositAddress: true, strict: true, appFees: [{ recipient: USER, fee: "50" }], referrer: "settlekit" });
  });

  it("scales the amount to HyperCore's 8-decimal perps USDC", () => {
    const body = buildRelayQuoteBody(baseRequest({ destination: destination("hypercore"), amountBase: 25_000_000n }));
    expect(body).toMatchObject({ destinationChainId: 1337, destinationCurrency: "0x00000000000000000000000000000000", amount: "2500000000" });
  });
});

describe("Relay quote parsing (recorded responses)", () => {
  it("parses Arbitrum USDC → Base USDC: approve + deposit calldata, fees, requestId", () => {
    const quote = parseRelayQuote(fixture("relay", "quote-arb-usdc-to-base"));
    expect(quote).toMatchObject({
      provider: "relay",
      requestId: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      origin: { chainId: 42161, token: ARB_USDC, symbol: "USDC", decimals: 6, amount: "5027158" },
      destination: { chainId: 8453, amount: "5000000", minimumAmount: "5000000", amountUsd: "4.999770" },
      recipient: RECIPIENT,
      slippageBps: 100,
      timeEstimateSec: expect.any(Number),
    });
    // (5.026927 - 4.999770) / 4.999770 = 54.3 bps, rounded up.
    expect(quote.feeBps).toBe(55);
    expect(quote.fees.totalUsd).toBe("0.027157");
    expect(quote.steps.map((step) => step.id)).toEqual(["approve", "deposit"]);
    const deposit = quote.steps[1]!.items[0]!.tx;
    expect(deposit).toMatchObject({ vm: "evm", chainId: 42161, from: USER, value: "0" });
    expect(quote.depositAddress).toBeUndefined();
  });

  it("parses native ETH → Solana USDC to a Solana recipient", () => {
    const quote = parseRelayQuote(fixture("relay", "quote-eth-native-to-solana-usdc"));
    expect(quote.destination).toMatchObject({ chainId: 792703809, token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", minimumAmount: "5000000" });
    expect(quote.recipient).toBe(SOL_RECIPIENT);
    expect(quote.steps).toHaveLength(1);
    expect(BigInt(quote.steps[0]!.items[0]!.tx.vm === "evm" ? (quote.steps[0]!.items[0]!.tx as { value: string }).value : "0")).toBeGreaterThan(0n);
  });

  it("parses the strict deposit address (Arbitrum USDC → Tempo USDC.e)", () => {
    const quote = parseRelayQuote(fixture("relay", "quote-arb-usdc-to-tempo-deposit"));
    expect(quote.depositAddress).toBe("0x3f33AFf7Fdac46663d03e14E7f3cAB0aeCbC8378");
    expect(quote.destination).toMatchObject({ chainId: 4217, token: "0x20c000000000000000000000b9537d11c60e8b50" });
  });

  it("parses HyperCore perps USDC (8 decimals) and prices the fixed bridge fee", () => {
    const quote = parseRelayQuote(fixture("relay", "quote-base-usdc-to-hypercore"));
    expect(quote.destination).toMatchObject({ chainId: 1337, decimals: 8, minimumAmount: "2500000000" });
    expect(quote.feeBps).toBeGreaterThan(400);
  });

  it("reports the app fee", () => {
    const quote = parseRelayQuote(fixture("relay", "quote-base-eth-to-robinhood-appfee"));
    expect(Number(quote.fees.appUsd)).toBeGreaterThan(0);
    expect(quote.destination).toMatchObject({ chainId: 4663, token: "0x5fc5360d0400a0fd4f2af552add042d716f1d168" });
  });

  it("refuses malformed bodies", () => {
    expect(() => parseRelayQuote({ steps: [] })).toThrow(RouteError);
    expect(() => parseRelayQuote(null)).toThrow(/unexpected/);
  });
});

describe("Relay provider over HTTP (replayed)", () => {
  it("POSTs /quote with the API key and parses the answer", async () => {
    const fetchImpl = replayFetch([{ match: (url) => url.endsWith("/quote"), body: fixture("relay", "quote-arb-usdc-to-base") }]);
    const relay = createRelayProvider({ fetch: fetchImpl, apiKey: "rk_test", referrer: "settlekit" });
    const quote = await relay.quote(baseRequest());
    expect(quote.provider).toBe("relay");
    expect(fetchImpl.calls[0]).toMatchObject({
      method: "POST",
      url: "https://api.relay.link/quote",
      headers: { "x-api-key": "rk_test" },
      body: { tradeType: "EXACT_OUTPUT", referrer: "settlekit" },
    });
  });

  it("omits the referrer without an API key (Relay answers 401 UNAUTHORIZED_QUOTE otherwise)", async () => {
    const fetchImpl = replayFetch([
      { match: (_url) => true, status: 401, body: fixture("relay", "quote-unauthorized-referrer") },
    ]);
    const relay = createRelayProvider({ fetch: fetchImpl, referrer: "settlekit" });
    await expect(relay.quote(baseRequest())).rejects.toMatchObject({ code: "provider_rejected", providerCode: "UNAUTHORIZED_QUOTE" });
    expect(fetchImpl.calls[0]!.body).not.toHaveProperty("referrer");
    expect(fetchImpl.calls[0]!.headers).not.toHaveProperty("x-api-key");
  });

  it.each([
    ["quote-blocked", 400, "BLOCKED_WALLET_ADDRESS"],
    ["quote-invalid-amount", 400, "AMOUNT_TOO_LOW"],
  ])("maps %s to provider_rejected", async (name, status, providerCode) => {
    const relay = createRelayProvider({ fetch: replayFetch([{ match: () => true, status, body: fixture("relay", name) }]) });
    await expect(relay.quote(baseRequest())).rejects.toMatchObject({ code: "provider_rejected", providerCode });
  });

  it("maps 429, 5xx and network errors", async () => {
    const limited = createRelayProvider({ fetch: replayFetch([{ match: () => true, status: 429, body: { message: "slow down" } }]) });
    await expect(limited.quote(baseRequest())).rejects.toMatchObject({ code: "rate_limited" });
    const down = createRelayProvider({ fetch: replayFetch([{ match: () => true, status: 503, body: { message: "maintenance" } }]) });
    await expect(down.quote(baseRequest())).rejects.toMatchObject({ code: "provider_unavailable" });
    const offline = createRelayProvider({ fetch: (async () => Promise.reject(new Error("ENOTFOUND"))) as never });
    await expect(offline.quote(baseRequest())).rejects.toMatchObject({ code: "provider_unavailable", message: expect.stringMatching(/ENOTFOUND/) });
  });

  it("GETs /intents/status/v3 by requestId", async () => {
    const fetchImpl = replayFetch([{ match: (url) => url.includes("/intents/status/v3"), body: fixture("relay", "status-success") }]);
    const relay = createRelayProvider({ fetch: fetchImpl });
    const status = await relay.status({ requestId: "0xabc", originChainId: 4663, destinationChainId: 8453 });
    expect(fetchImpl.calls[0]!.url).toBe("https://api.relay.link/intents/status/v3?requestId=0xabc");
    expect(status.state).toBe("success");
  });
});

describe("Relay status parsing (recorded)", () => {
  it("success: destination fill hashes", () => {
    expect(parseRelayStatus(fixture("relay", "status-success"))).toEqual({
      provider: "relay",
      state: "success",
      originTxHashes: ["0x803b2c9aa540a01b5f7178a4e8e160ffb32af5110b412d592589bbf5e489fccc"],
      destinationTxHashes: ["0x1200b58d252579a000bb547ad271ef14f83ddbf08a2214ad8a8058188725fb8b"],
      refundTxHashes: [],
      originChainId: 4663,
      destinationChainId: 8453,
      detail: null,
      updatedAt: 1790691865509,
    });
  });

  it("success on HyperCore", () => {
    expect(parseRelayStatus(fixture("relay", "status-success-hypercore"))).toMatchObject({
      state: "success",
      destinationChainId: 1337,
      destinationTxHashes: ["0xd267e90cb92303e8d3e1044577e77b02049300f2542622ba7630945f7826ddd3"],
    });
  });

  it("refund: refund legs, never destination fills", () => {
    expect(parseRelayStatus(fixture("relay", "status-refund"))).toMatchObject({
      state: "refund",
      destinationTxHashes: [],
      refundTxHashes: ["4edWXjNyQDbxZzhXtcMiTTMrAux5HCKQgCmrVAHrRfaVQfev94iGA8zjjMWNeeDwnCW45fxm5XYD7GSk1hapKj8m"],
      detail: "DESTINATION_TOKEN_TRANSFER_REJECTED",
    });
  });

  it("failure, waiting and unknown", () => {
    expect(parseRelayStatus(fixture("relay", "status-failure"))).toMatchObject({
      state: "failure",
      destinationTxHashes: [],
      detail: "Failed swap: TRANSACTION_REVERTED",
    });
    expect(parseRelayStatus(fixture("relay", "status-waiting"))).toMatchObject({ state: "waiting", originTxHashes: [] });
    expect(parseRelayStatus(fixture("relay", "status-unknown"))).toMatchObject({ state: "unknown" });
    expect(parseRelayStatus({ status: "depositing" }).state).toBe("pending");
    expect(parseRelayStatus({ status: "brand-new-state" }).state).toBe("unknown");
  });
});
