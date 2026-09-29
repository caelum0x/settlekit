import { describe, expect, it } from "vitest";
import { buildLifiQuoteQuery, createLifiProvider, encodeApprove, parseLifiQuote, parseLifiStatus } from "../src/index.js";
import { fixture, replayFetch } from "./replay.js";
import { ARB_USDC, baseRequest, destination, RECIPIENT, USER } from "./requests.js";

const STATUS_QUERY = { requestId: "q1", originChainId: 42161, destinationChainId: 8453 };
const ORIGIN_TX = "0x6cfa94eeff7c0c3b2ad3005d9297e76fe340bdd0106bc3b8ee497bfb1a82e97a";

describe("LI.FI quote request", () => {
  it("asks /quote/toAmount for the exact amount to the merchant", () => {
    const query = buildLifiQuoteQuery(baseRequest({ slippageBps: 50, appFee: { recipient: USER, bps: 25 } }), "settlekit");
    expect(Object.fromEntries(query!)).toEqual({
      fromChain: "42161",
      toChain: "8453",
      fromToken: ARB_USDC,
      toToken: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      fromAddress: USER,
      toAddress: RECIPIENT,
      toAmount: "5000000",
      integrator: "settlekit",
      slippage: "0.005",
      fee: "0.0025",
    });
  });

  it("uses LI.FI's Solana chain id and refuses HyperCore", () => {
    expect(buildLifiQuoteQuery(baseRequest({ destination: destination("solana") }), "x")!.get("toChain")).toBe("1151111081099710");
    expect(buildLifiQuoteQuery(baseRequest({ destination: destination("hypercore") }), "x")).toBeNull();
  });
});

describe("LI.FI quote parsing (recorded)", () => {
  it("parses Arbitrum USDC → Base USDC with an approve step", () => {
    const quote = parseLifiQuote(fixture("lifi", "quote-arb-usdc-to-base"));
    expect(quote).toMatchObject({
      provider: "lifi",
      requestId: "9fe25519-2aad-405a-8e50-9813c9639c52:0",
      origin: { chainId: 42161, amount: "5026929", amountUsd: "5.0365" },
      destination: { chainId: 8453, amount: "5010033", minimumAmount: "5010033" },
      recipient: RECIPIENT,
      slippageBps: 50,
      feeBps: 93,
    });
    expect(quote.steps.map((step) => step.id)).toEqual(["approve", "deposit"]);
    expect(quote.steps[0]!.items[0]!.tx).toEqual({
      vm: "evm",
      chainId: 42161,
      from: USER,
      to: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      data: encodeApprove("0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", 5_026_929n),
      value: "0",
    });
    expect(quote.steps[1]!.items[0]!.tx).toMatchObject({ vm: "evm", to: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", value: "0", gas: String(0x30a714) });
  });

  it("parses native ETH on Base → Tempo USDC.e without an approval", () => {
    const quote = parseLifiQuote(fixture("lifi", "quote-base-eth-to-tempo"));
    expect(quote.steps.map((step) => step.id)).toEqual(["deposit"]);
    expect(quote.destination).toMatchObject({ chainId: 4217, minimumAmount: "5009997" });
    expect(quote.steps[0]!.items[0]!.tx).toMatchObject({ value: BigInt("0x698326ac3adc3").toString() });
  });

  it("encodes approve calldata", () => {
    expect(encodeApprove("0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", 255n)).toBe(
      "0x095ea7b30000000000000000000000001231deb6f5749ef6ce6943a275a1d3e7486f4eae00000000000000000000000000000000000000000000000000000000000000ff",
    );
  });
});

describe("LI.FI provider over HTTP (replayed)", () => {
  it("GETs the quote with the API key header", async () => {
    const fetchImpl = replayFetch([{ match: (url) => url.includes("/quote/toAmount"), body: fixture("lifi", "quote-arb-usdc-to-base") }]);
    const quote = await createLifiProvider({ fetch: fetchImpl, apiKey: "lk" }).quote(baseRequest());
    expect(quote.requestId).toContain("9fe25519");
    expect(fetchImpl.calls[0]!.url.startsWith("https://li.quest/v1/quote/toAmount?")).toBe(true);
    expect(fetchImpl.calls[0]!.headers).toMatchObject({ "x-lifi-api-key": "lk" });
  });

  it("maps a 404 token error to provider_rejected", async () => {
    const lifi = createLifiProvider({ fetch: replayFetch([{ match: () => true, status: 404, body: fixture("lifi", "quote-error") }]) });
    await expect(lifi.quote(baseRequest())).rejects.toMatchObject({ code: "provider_rejected", providerCode: "1003" });
  });

  it("does not do deposit addresses or HyperCore", async () => {
    const lifi = createLifiProvider({ fetch: replayFetch([]) });
    expect(lifi.supports(destination("base"), { chainId: 1, token: "0x0" }, true)).toBe(false);
    expect(lifi.supports(destination("hypercore"), { chainId: 1, token: "0x0" }, false)).toBe(false);
    await expect(lifi.quote(baseRequest({ depositAddress: true }))).rejects.toMatchObject({ code: "unsupported" });
  });

  it("tracks status by origin tx; waits until one exists or is indexed", async () => {
    const fetchImpl = replayFetch([
      { match: (url) => url.includes(ORIGIN_TX), body: fixture("lifi", "status-done") },
      { match: () => true, status: 404, body: fixture("lifi", "status-notfound") },
    ]);
    const lifi = createLifiProvider({ fetch: fetchImpl });
    expect((await lifi.status(STATUS_QUERY)).state).toBe("waiting");
    expect(fetchImpl.calls).toHaveLength(0);
    expect((await lifi.status({ ...STATUS_QUERY, originTxHash: `0x${"11".repeat(32)}` })).state).toBe("waiting");
    const done = await lifi.status({ ...STATUS_QUERY, originTxHash: ORIGIN_TX });
    expect(done).toMatchObject({
      state: "success",
      originTxHashes: [ORIGIN_TX],
      destinationTxHashes: ["0x7e932fbf809a4c6d89c87760667898406cad5e31c650f19edd8e92c81fc298e2"],
    });
    expect(fetchImpl.calls.at(-1)!.url).toBe(`https://li.quest/v1/status?txHash=${ORIGIN_TX}&fromChain=42161&toChain=8453`);
  });
});

describe("LI.FI status mapping", () => {
  const done = fixture("lifi", "status-done") as Record<string, unknown>;

  // Derived from the recorded DONE response by changing status/substatus only.
  it.each([
    [{ ...done, substatus: "REFUNDED" }, "refund"],
    [{ ...done, substatus: "PARTIAL" }, "failure"],
    [{ ...done, status: "FAILED", substatus: "UNKNOWN_ERROR" }, "failure"],
    [{ ...done, status: "INVALID" }, "failure"],
    [{ ...done, status: "PENDING", substatus: "WAIT_DESTINATION_TRANSACTION" }, "pending"],
    [{ status: "NOT_FOUND" }, "waiting"],
  ])("maps %# to %s", (body, state) => {
    const status = parseLifiStatus(body, STATUS_QUERY);
    expect(status.state).toBe(state);
    if (state === "refund") expect(status.refundTxHashes).toEqual(["0x7e932fbf809a4c6d89c87760667898406cad5e31c650f19edd8e92c81fc298e2"]);
    if (state !== "success") expect(status.destinationTxHashes).toEqual([]);
  });
});
