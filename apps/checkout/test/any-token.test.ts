/**
 * Any-token checkout over recorded Relay responses (test/fixtures/routing,
 * recorded 2026-09-29) and the recorded Base receipt of a real Relay fill.
 * The session is paid ONLY when the destination Transfer verifies; a
 * provider "success" alone never pays.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import type { FullEvmRpc } from "@settlekit/arc";
import { money, type CheckoutRoute } from "@settlekit/common";
import type { FetchLike } from "@settlekit/routing";

import { getAnyTokenOptions, getRouteStatusView, loadRoutingRuntime, quoteRoute } from "../lib/any-token";
import { CheckoutError } from "../lib/errors";
import { selectNetwork } from "../lib/network-select";
import { getDeliveredAccess } from "../lib/store";
import { FIELDS, evmRuntime, harness, openSession } from "./harness";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/routing/${name}.json`, import.meta.url)), "utf8")) as unknown;
}

interface RecordedReceipt {
  chainId: string;
  head: string;
  blockTimestamp: string;
  receipt: {
    transactionHash: `0x${string}`;
    blockNumber: string;
    status: string;
    from: `0x${string}`;
    to: `0x${string}` | null;
    logs: Array<{ address: `0x${string}`; topics: `0x${string}`[]; data: `0x${string}`; logIndex: string }>;
  };
}

/** Base RPC serving the recorded receipt of Relay's fill (head from the recording). */
function recordedBaseRpc(): FullEvmRpc {
  const record = fixture("base-relay-fill") as RecordedReceipt;
  const r = record.receipt;
  return {
    getChainId: async () => Number(record.chainId),
    getBlockNumber: async () => BigInt(record.head),
    getBlockTimestamp: async () => BigInt(record.blockTimestamp),
    estimateFeesPerGas: async () => ({ maxFeePerGas: 1n, maxPriorityFeePerGas: 1n }),
    getTransactionReceipt: async (hash) =>
      hash === r.transactionHash
        ? {
            transactionHash: r.transactionHash,
            blockNumber: BigInt(r.blockNumber),
            status: r.status === "0x1" ? "success" : "reverted",
            from: r.from,
            to: r.to,
            logs: r.logs.map((log) => ({ ...log, topics: log.topics as [`0x${string}`, ...`0x${string}`[]], logIndex: Number(log.logIndex) })),
          }
        : null,
  };
}

const FILL_HASH = "0x1200b58d252579a000bb547ad271ef14f83ddbf08a2214ad8a8058188725fb8b";
/** Recipient of the recorded fill (6.53202 USDC on Base). */
const FILL_RECIPIENT = getAddress("0xe0809ceb8726e0eea0d42ad85fa82a9e587bd10f");
/** Recipient the recorded quote pays. */
const QUOTE_RECIPIENT = getAddress("0x1f2e3d4c5b6a79880706a5b4c3d2e1f0a9b8c7d6");
const BUYER = getAddress("0x5b1e2c3d4e5f60718293a4b5c6d7e8f901234567");
const ARB_USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const NOW = new Date("2026-09-29T14:20:00Z");

type Reply = { status?: number; body: unknown } | Error;

function relayFetch(replies: { quote?: Reply; status?: Reply }): FetchLike & { calls: Array<{ url: string; body: unknown }> } {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    const reply = url.endsWith("/quote") ? replies.quote : replies.status;
    if (reply === undefined) throw new Error(`unexpected request ${url}`);
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  }) as FetchLike & { calls: Array<{ url: string; body: unknown }> };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const ROUTING_ENV = { ROUTING_ENABLED: "true", LIFI_ENABLED: "false" };
const CHAIN_ENV = { SETTLEKIT_CHAIN_ENV: "mainnet", ENABLED_EVM_CHAINS: "base" };

function setup(replies: { quote?: Reply; status?: Reply } = {}, routingEnv: Record<string, string> = ROUTING_ENV) {
  const fetchImpl = relayFetch(replies);
  const h = harness({ evm: evmRuntime(CHAIN_ENV, { base: recordedBaseRpc() }) });
  return { h, fetchImpl, routing: loadRoutingRuntime(routingEnv, fetchImpl) };
}

function pendingRoute(overrides: Partial<CheckoutRoute> = {}): CheckoutRoute {
  return {
    provider: "relay",
    requestId: "0x1790691833dfbb197916e84a4e254749e9b11e714f8ee0ca67d43fb1a7c1ae67",
    network: "base",
    originChainId: 4663,
    originToken: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
    originAmount: "6593400",
    originAddress: BUYER,
    quotedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 120_000).toISOString(),
    state: "pending",
    ...overrides,
  };
}

async function expectCode(promise: Promise<unknown>, code: CheckoutError["code"]): Promise<CheckoutError> {
  const error = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(CheckoutError);
  expect((error as CheckoutError).code).toBe(code);
  return error as CheckoutError;
}

describe("any-token options", () => {
  it("offers the policy's origins for a mainnet Base session", async () => {
    const { h, routing } = setup();
    const session = await openSession(h, "base", { payToAddress: QUOTE_RECIPIENT });
    const options = await getAnyTokenOptions(session.id, h.deps, routing);
    expect(options).toMatchObject({ available: true, destination: { network: "base", symbol: "USDC" }, maxFeeBps: 300, route: null });
    expect(options.origins.map((origin) => origin.name)).toContain("Arbitrum");
  });

  it("is unavailable when routing is off or the chain is a testnet", async () => {
    const { h } = setup();
    const session = await openSession(h, "base", { payToAddress: QUOTE_RECIPIENT });
    const off = await getAnyTokenOptions(session.id, h.deps, loadRoutingRuntime({}));
    expect(off).toMatchObject({ available: false, origins: [] });

    const testnet = harness({ evm: evmRuntime({ ENABLED_EVM_CHAINS: "base", SETTLEKIT_CHAIN_ENV: "testnet" }, { base: recordedBaseRpc() }) });
    const testSession = await openSession(testnet, "base");
    const result = await getAnyTokenOptions(testSession.id, testnet.deps, loadRoutingRuntime(ROUTING_ENV));
    expect(result).toMatchObject({ available: false, reason: expect.stringMatching(/mainnet/) });
  });
});

describe("quoteRoute", () => {
  it("quotes EXACT_OUTPUT to the merchant with the buyer as refund address and stores the route", async () => {
    const { h, routing, fetchImpl } = setup({ quote: { body: fixture("quote-arb-usdc-to-base") } });
    const session = await openSession(h, "base", { payToAddress: QUOTE_RECIPIENT, amount: money("5", "USDC") });
    const view = await quoteRoute(
      { sessionId: session.id, originChainId: 42161, originToken: ARB_USDC, originAddress: BUYER, depositAddress: false, fields: FIELDS },
      h.deps,
      routing,
      NOW,
    );
    expect(fetchImpl.calls[0]!.body).toMatchObject({
      user: BUYER,
      recipient: QUOTE_RECIPIENT,
      refundTo: BUYER,
      originChainId: 42161,
      destinationChainId: 8453,
      amount: "5000000",
      tradeType: "EXACT_OUTPUT",
      slippageTolerance: "100",
    });
    expect(view).toMatchObject({
      provider: "relay",
      origin: { symbol: "USDC", formatted: "5.027158" },
      destination: { formatted: "5", symbol: "USDC" },
      fees: { feeBps: 55 },
      walletExecutable: true,
      depositAddress: null,
      refundTo: BUYER,
      expiresAt: "2026-09-29T14:22:00.000Z",
    });
    expect(view.transactions).toHaveLength(2);
    const stored = await h.checkouts.findById(session.id);
    expect(stored?.route).toMatchObject({ provider: "relay", requestId: view.requestId, state: "quoted", network: "base", originAddress: BUYER });
    expect(stored?.status).toBe("open");
  });

  it("rejects quotes that break the policy (fee cap) with route_rejected", async () => {
    const { h, routing } = setup({ quote: { body: fixture("quote-arb-usdc-to-base") } }, { ...ROUTING_ENV, ROUTE_MAX_FEE_BPS: "10" });
    const session = await openSession(h, "base", { payToAddress: QUOTE_RECIPIENT, amount: money("5", "USDC") });
    const error = await expectCode(
      quoteRoute({ sessionId: session.id, originChainId: 42161, originToken: ARB_USDC, originAddress: BUYER, depositAddress: false, fields: FIELDS }, h.deps, routing, NOW),
      "route_rejected",
    );
    expect(error.message).toMatch(/above the 0\.10% limit/);
    expect((await h.checkouts.findById(session.id))?.route).toBeUndefined();
  });

  it("rejects a quote that would underpay (session owes more than the route guarantees)", async () => {
    const { h, routing } = setup({ quote: { body: fixture("quote-arb-usdc-to-base") } });
    const session = await openSession(h, "base", { payToAddress: QUOTE_RECIPIENT });
    await expectCode(
      quoteRoute({ sessionId: session.id, originChainId: 42161, originToken: ARB_USDC, originAddress: BUYER, depositAddress: false, fields: FIELDS }, h.deps, routing, NOW),
      "route_rejected",
    );
  });

  it("validates the origin and the buyer's refund address", async () => {
    const { h, routing } = setup();
    const session = await openSession(h, "base", { payToAddress: QUOTE_RECIPIENT });
    const input = { sessionId: session.id, originChainId: 42161, originToken: ARB_USDC, originAddress: BUYER, depositAddress: false, fields: FIELDS };
    await expectCode(quoteRoute({ ...input, originToken: "0x1111111111111111111111111111111111111111" }, h.deps, routing, NOW), "invalid_request");
    await expectCode(quoteRoute({ ...input, originAddress: "not-an-address" }, h.deps, routing, NOW), "invalid_request");
    await expectCode(quoteRoute({ ...input, originChainId: 792703809, originToken: "11111111111111111111111111111111" }, h.deps, routing, NOW), "invalid_request");
    await expectCode(quoteRoute({ ...input, fields: {} }, h.deps, routing, NOW), "fields_incomplete");
  });

  it("maps provider outages to provider_unavailable and a disabled router to 503", async () => {
    const { h, routing } = setup({ quote: new Error("ECONNRESET") });
    const session = await openSession(h, "base", { payToAddress: QUOTE_RECIPIENT, amount: money("5", "USDC") });
    const input = { sessionId: session.id, originChainId: 42161, originToken: ARB_USDC, originAddress: BUYER, depositAddress: false, fields: FIELDS };
    await expectCode(quoteRoute(input, h.deps, routing, NOW), "provider_unavailable");
    await expectCode(quoteRoute(input, h.deps, loadRoutingRuntime({}), NOW), "network_not_configured");
  });
});

describe("route status → destination verification", () => {
  async function routedSession(h: ReturnType<typeof setup>["h"], overrides: Parameters<typeof openSession>[2] = {}) {
    return openSession(h, "base", { payToAddress: FILL_RECIPIENT, amount: money("6.5", "USDC"), route: pendingRoute(), ...overrides });
  }

  it("pays once the provider's fill verifies on Base (recorded Relay fill)", async () => {
    const { h, routing } = setup({ status: { body: fixture("status-success") } });
    // A payer bound earlier (another wallet) does not apply to the solver's fill.
    const session = await routedSession(h, { payerAddress: BUYER });
    const view = await getRouteStatusView({ sessionId: session.id }, h.deps, routing, NOW);
    expect(view).toMatchObject({
      state: "paid",
      destinationTxHash: FILL_HASH,
      destinationExplorerUrl: `https://basescan.org/tx/${FILL_HASH}`,
      originTxHash: "0x803b2c9aa540a01b5f7178a4e8e160ffb32af5110b412d592589bbf5e489fccc",
      originExplorerUrl: "https://robinhoodchain.blockscout.com/tx/0x803b2c9aa540a01b5f7178a4e8e160ffb32af5110b412d592589bbf5e489fccc",
    });
    const stored = await h.checkouts.findById(session.id);
    expect(stored).toMatchObject({ status: "completed", route: { state: "success", destinationTxHash: FILL_HASH } });
    expect(await h.payments.findByTxHash(FILL_HASH)).toMatchObject({ status: "confirmed", network: "base" });
    expect(await getDeliveredAccess(session.id, h.deps)).toHaveLength(1);
    // Polling after payment keeps answering paid without calling the provider again.
    expect((await getRouteStatusView({ sessionId: session.id }, h.deps, routing, NOW)).state).toBe("paid");
  });

  it("provider success but no destination Transfer to payTo → unpaid", async () => {
    const { h, routing } = setup({ status: { body: fixture("status-success") } });
    const session = await routedSession(h, { payToAddress: QUOTE_RECIPIENT });
    const view = await getRouteStatusView({ sessionId: session.id }, h.deps, routing, NOW);
    expect(view.state).toBe("unverified");
    expect(view.message).toMatch(/no qualifying payment/);
    expect((await h.checkouts.findById(session.id))?.status).toBe("open");
    expect(await h.payments.findByCheckoutSessionId(session.id)).toEqual([]);
  });

  it("provider success with a smaller delivery than owed → unpaid", async () => {
    const { h, routing } = setup({ status: { body: fixture("status-success") } });
    const session = await routedSession(h, { amount: money("7", "USDC") });
    expect((await getRouteStatusView({ sessionId: session.id }, h.deps, routing, NOW)).state).toBe("unverified");
    expect((await h.checkouts.findById(session.id))?.status).toBe("open");
  });

  it("provider success on a session created after the fill → unpaid", async () => {
    const { h, routing } = setup({ status: { body: fixture("status-success") } });
    const session = await routedSession(h, { createdAt: "2026-09-29T15:00:00.000Z" });
    expect((await getRouteStatusView({ sessionId: session.id }, h.deps, routing, NOW)).state).toBe("unverified");
  });

  it("refund: records the refund leg, notifies, never pays", async () => {
    const { h, routing } = setup({ status: { body: fixture("status-refund") } });
    const session = await routedSession(h, { route: pendingRoute({ originChainId: 792703809 }) });
    const view = await getRouteStatusView({ sessionId: session.id }, h.deps, routing, NOW);
    expect(view).toMatchObject({
      state: "refund",
      refundTo: BUYER,
      refundTxHash: "4edWXjNyQDbxZzhXtcMiTTMrAux5HCKQgCmrVAHrRfaVQfev94iGA8zjjMWNeeDwnCW45fxm5XYD7GSk1hapKj8m",
      refundExplorerUrl: "https://solscan.io/tx/4edWXjNyQDbxZzhXtcMiTTMrAux5HCKQgCmrVAHrRfaVQfev94iGA8zjjMWNeeDwnCW45fxm5XYD7GSk1hapKj8m",
      destinationTxHash: null,
    });
    expect((await h.checkouts.findById(session.id))?.status).toBe("open");
  });

  it("waiting, origin hash capture and provider outages", async () => {
    const { h, routing } = setup({ status: { body: fixture("status-waiting") } });
    const session = await routedSession(h, { route: pendingRoute({ state: "quoted" }) });
    const origin = `0x${"ab".repeat(32)}`;
    expect(await getRouteStatusView({ sessionId: session.id, originTxHash: origin.toUpperCase().replace("0X", "0x") }, h.deps, routing, NOW)).toMatchObject({
      state: "waiting",
      originTxHash: origin,
    });
    await expectCode(getRouteStatusView({ sessionId: session.id, originTxHash: "nope" }, h.deps, routing, NOW), "invalid_request");

    const down = setup({ status: new Error("ETIMEDOUT") });
    const downSession = await routedSession(down.h);
    await expectCode(getRouteStatusView({ sessionId: downSession.id }, down.h.deps, down.routing, NOW), "provider_unavailable");
  });

  it("refuses status for sessions without a route", async () => {
    const { h, routing } = setup();
    const session = await openSession(h, "base");
    await expectCode(getRouteStatusView({ sessionId: session.id }, h.deps, routing, NOW), "session_not_payable");
  });

  it("locks the network while a route is moving funds", async () => {
    const { h } = setup();
    const session = await routedSession(h, { acceptedNetworks: ["base", "arbitrum"] });
    const error = await expectCode(selectNetwork(session.id, "arbitrum", h.deps, NOW), "session_not_payable");
    expect(error.message).toMatch(/cross-chain payment/);
  });
});
