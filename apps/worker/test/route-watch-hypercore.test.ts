/**
 * Worker: the route-watch job (Relay status replayed from recordings, the
 * destination fill verified against the recorded Base receipt), HyperCore
 * payment confirmation through the ledger, and Tempo memo enforcement.
 * No network.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { money, toIso, type CheckoutRoute, type CheckoutSession } from "@settlekit/common";
import { TRANSFER_EVENT_TOPIC, type FullEvmRpc, type Hex } from "@settlekit/arc";
import { getEvmChain, sessionMemo, TRANSFER_WITH_MEMO_TOPIC } from "@settlekit/chains";
import type { HyperliquidTransport, LedgerUpdate } from "@settlekit/hyperliquid";
import type { FetchLike } from "@settlekit/routing";
import type { GitHubApi } from "@settlekit/github";
import type { DiscordApi } from "@settlekit/discord";
import { loadConfig } from "../src/config.js";
import { buildJobContext, type RuntimeDeps } from "../src/runtime.js";
import { InMemoryWorkerStore } from "../src/stores.js";
import { paymentConfirmJob } from "../src/jobs/payment-confirm-job.js";
import { resetRouteWatchState, routeWatchJob } from "../src/jobs/route-watch.js";
import { allJobs, workerJobs } from "../src/jobs/index.js";

const ENV: Record<string, string> = {
  ARC_RPC_URL: "http://localhost:8545",
  ARC_USDC_ADDRESS: "0x3600000000000000000000000000000000000000",
  RESEND_API_KEY: "re_test_key",
  GITHUB_APP_ID: "12345",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
  GITHUB_INSTALLATION_ID: "9999",
  DISCORD_BOT_TOKEN: "bot.token.value",
  FILE_DELIVERY_BASE_URL: "https://dl.settlekit.dev/download",
  FILE_DELIVERY_SECRET: "file-secret-value",
  LICENSE_TOKEN_SECRET: "license-token-secret",
  WEBHOOK_SIGNING_SECRET: "wh-signing-secret",
};

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), "utf8")) as unknown;
}

interface RecordedReceipt {
  chainId: string;
  head: string;
  blockTimestamp: string;
  receipt: {
    transactionHash: Hex;
    blockNumber: string;
    status: string;
    from: Hex;
    to: Hex | null;
    logs: Array<{ address: Hex; topics: Hex[]; data: Hex; logIndex: string }>;
  };
}

/** Base RPC replaying the recorded receipt of Relay's fill; counts receipt lookups. */
function recordedBaseRpc(): FullEvmRpc & { receiptCalls: number } {
  const record = fixture("base-relay-fill") as RecordedReceipt;
  const r = record.receipt;
  const rpc = {
    receiptCalls: 0,
    getChainId: async () => Number(record.chainId),
    getBlockNumber: async () => BigInt(record.head),
    getBlockTimestamp: async () => BigInt(record.blockTimestamp),
    estimateFeesPerGas: async () => ({ maxFeePerGas: 1n, maxPriorityFeePerGas: 1n }),
    getTransactionReceipt: async (hash: Hex) => {
      rpc.receiptCalls += 1;
      return hash === r.transactionHash
        ? {
            transactionHash: r.transactionHash,
            blockNumber: BigInt(r.blockNumber),
            status: "success" as const,
            from: r.from,
            to: r.to,
            logs: r.logs.map((log) => ({ ...log, topics: log.topics as [Hex, ...Hex[]], logIndex: Number(log.logIndex) })),
          }
        : null;
    },
  };
  return rpc;
}

function relayFetch(body: unknown | Error): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as FetchLike & { calls: string[] };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const FILL_HASH = "0x1200b58d252579a000bb547ad271ef14f83ddbf08a2214ad8a8058188725fb8b";
const FILL_RECIPIENT = "0xe0809CEb8726e0EEA0d42AD85Fa82A9e587Bd10F";
const OTHER = "0x3333333333333333333333333333333333333333";
const BUYER = "0x2222222222222222222222222222222222222222" as Hex;
const QUOTED_AT = new Date("2026-09-29T14:20:00Z");
const NOW = new Date("2026-09-29T14:30:00Z");
const ROUTING_ENV = { ROUTING_ENABLED: "true", LIFI_ENABLED: "false", SETTLEKIT_CHAIN_ENV: "mainnet", ENABLED_EVM_CHAINS: "base" };

function route(overrides: Partial<CheckoutRoute> = {}): CheckoutRoute {
  return {
    provider: "relay",
    requestId: "0x1790691833dfbb197916e84a4e254749e9b11e714f8ee0ca67d43fb1a7c1ae67",
    network: "base",
    originChainId: 4663,
    originToken: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
    originAmount: "6593400",
    originAddress: BUYER,
    quotedAt: toIso(QUOTED_AT),
    expiresAt: toIso(new Date(QUOTED_AT.getTime() + 120_000)),
    state: "pending",
    ...overrides,
  };
}

function session(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    id: "cs_route",
    organizationId: "org_1",
    merchantId: "mch_1",
    customerId: "cus_1",
    lineItems: [],
    amount: money("6.5", "USDC"),
    status: "open",
    payToAddress: FILL_RECIPIENT,
    network: "base",
    expiresAt: toIso(new Date(NOW.getTime() + 86_400_000)),
    collectedFields: {},
    createdAt: "2026-09-29T14:00:00.000Z",
    route: route(),
    ...overrides,
  };
}

function setup(env: Record<string, string>, extras: Partial<RuntimeDeps> = {}) {
  const stores = new InMemoryWorkerStore();
  const { ctx } = buildJobContext({
    config: loadConfig({ ...ENV, ...env }),
    githubApi: {} as GitHubApi,
    discordApi: {} as DiscordApi,
    emailTransport: { send: async () => ({ id: "email_1" }) },
    stores,
    now: () => NOW,
    ...extras,
  });
  return { ctx, stores };
}

beforeEach(() => resetRouteWatchState());

describe("route-watch job", () => {
  it("is registered and a no-op without ROUTING_ENABLED", async () => {
    expect(workerJobs).toContain("route-watch");
    expect(allJobs().map((job) => job.name)).toContain("route-watch");
    const fetchImpl = relayFetch(fixture("status-success"));
    const { ctx, stores } = setup({ SETTLEKIT_CHAIN_ENV: "mainnet", ENABLED_EVM_CHAINS: "base" }, { routingFetch: fetchImpl });
    await stores.upsertCheckoutSession(session());
    expect(await routeWatchJob.run(ctx)).toEqual({ processed: 0, failed: 0 });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it("confirms the payment once the provider's fill verifies on Base (payer binding does not apply)", async () => {
    const rpc = recordedBaseRpc();
    const fetchImpl = relayFetch(fixture("status-success"));
    const { ctx, stores } = setup(ROUTING_ENV, { routingFetch: fetchImpl, evmRpcs: { base: rpc } });
    await stores.upsertCheckoutSession(session({ payerAddress: BUYER }));

    expect(await routeWatchJob.run(ctx)).toEqual({ processed: 1, failed: 0 });
    expect(fetchImpl.calls[0]).toBe(
      "https://api.relay.link/intents/status/v3?requestId=0x1790691833dfbb197916e84a4e254749e9b11e714f8ee0ca67d43fb1a7c1ae67",
    );
    const payment = await stores.paymentByTxHash(FILL_HASH);
    expect(payment).toMatchObject({ status: "confirmed", network: "base", checkoutSessionId: "cs_route", txHash: FILL_HASH });
    // The session itself is completed + fulfilled by the checkout on its next confirm.
    expect((await stores.getCheckoutSession("cs_route"))?.status).toBe("open");
    // Idempotent: the fill already backs the payment.
    expect(await routeWatchJob.run(ctx)).toEqual({ processed: 0, failed: 0 });
  });

  it("provider success but no destination Transfer to payTo → unpaid (and backs off)", async () => {
    const rpc = recordedBaseRpc();
    const { ctx, stores } = setup(ROUTING_ENV, { routingFetch: relayFetch(fixture("status-success")), evmRpcs: { base: rpc } });
    await stores.upsertCheckoutSession(session({ payToAddress: OTHER }));
    expect(await routeWatchJob.run(ctx)).toEqual({ processed: 0, failed: 0 });
    expect(await stores.paymentByTxHash(FILL_HASH)).toBeUndefined();
    const lookups = rpc.receiptCalls;
    expect(await routeWatchJob.run(ctx)).toEqual({ processed: 0, failed: 0 });
    expect(rpc.receiptCalls).toBe(lookups);
  });

  it("provider success with an underpaying fill, or a fill older than the session → unpaid", async () => {
    const under = setup(ROUTING_ENV, { routingFetch: relayFetch(fixture("status-success")), evmRpcs: { base: recordedBaseRpc() } });
    await under.stores.upsertCheckoutSession(session({ amount: money("7", "USDC") }));
    expect(await routeWatchJob.run(under.ctx)).toEqual({ processed: 0, failed: 0 });
    expect(await under.stores.paymentByTxHash(FILL_HASH)).toBeUndefined();

    resetRouteWatchState();
    const late = setup(ROUTING_ENV, { routingFetch: relayFetch(fixture("status-success")), evmRpcs: { base: recordedBaseRpc() } });
    await late.stores.upsertCheckoutSession(session({ createdAt: "2026-09-29T14:28:00.000Z" }));
    expect(await routeWatchJob.run(late.ctx)).toEqual({ processed: 0, failed: 0 });
    expect(await late.stores.paymentByTxHash(FILL_HASH)).toBeUndefined();
  });

  it("never pays a fill that already backs another session's payment", async () => {
    const { ctx, stores } = setup(ROUTING_ENV, { routingFetch: relayFetch(fixture("status-success")), evmRpcs: { base: recordedBaseRpc() } });
    await stores.upsertCheckoutSession(session());
    await stores.upsertPayment({
      id: "pay_other", organizationId: "org_1", checkoutSessionId: "cs_other", customerId: "cus_2", amount: money("6.5", "USDC"),
      network: "base", txHash: FILL_HASH, confirmations: 3, status: "confirmed", createdAt: toIso(NOW),
    });
    expect(await routeWatchJob.run(ctx)).toEqual({ processed: 0, failed: 0 });
    expect((await stores.paymentByTxHash(FILL_HASH))?.checkoutSessionId).toBe("cs_other");
  });

  it("refunds, waiting routes and old routes record nothing; provider outages count as failures", async () => {
    for (const status of ["status-refund", "status-waiting"]) {
      const { ctx, stores } = setup(ROUTING_ENV, { routingFetch: relayFetch(fixture(status)), evmRpcs: { base: recordedBaseRpc() } });
      await stores.upsertCheckoutSession(session());
      expect(await routeWatchJob.run(ctx)).toEqual({ processed: 0, failed: 0 });
      expect(await stores.pendingPayments()).toEqual([]);
    }
    const fetchImpl = relayFetch(fixture("status-success"));
    const old = setup(ROUTING_ENV, { routingFetch: fetchImpl, evmRpcs: { base: recordedBaseRpc() } });
    await old.stores.upsertCheckoutSession(session({ route: route({ quotedAt: "2026-09-28T00:00:00.000Z" }) }));
    expect(await routeWatchJob.run(old.ctx)).toEqual({ processed: 0, failed: 0 });
    expect(fetchImpl.calls).toHaveLength(0);

    const down = setup(ROUTING_ENV, { routingFetch: relayFetch(new Error("ECONNRESET")), evmRpcs: { base: recordedBaseRpc() } });
    await down.stores.upsertCheckoutSession(session());
    expect(await routeWatchJob.run(down.ctx)).toEqual({ processed: 0, failed: 1 });
  });
});

// --- HyperCore -------------------------------------------------------------------

const HC_HASH = `0x${"7b".repeat(32)}`;

function hyperliquid(ledger: LedgerUpdate[]): HyperliquidTransport {
  return {
    isTestnet: false,
    async request<T>(_endpoint: "info" | "exchange", payload: unknown): Promise<T> {
      const { startTime } = payload as { startTime: number };
      return ledger.filter((entry) => entry.time >= startTime) as T;
    },
  };
}

async function seedHyperCore(stores: InMemoryWorkerStore, extra: Partial<CheckoutSession> = {}) {
  await stores.upsertCheckoutSession(session({ id: "cs_hc", network: "hypercore", payToAddress: OTHER, amount: money("10", "USDC"), route: undefined, ...extra }));
  await stores.upsertPayment({
    id: "pay_hc", organizationId: "org_1", checkoutSessionId: "cs_hc", customerId: "cus_1", amount: money("10", "USDC"),
    network: "hypercore", txHash: HC_HASH, confirmations: 0, status: "pending", createdAt: toIso(NOW),
  });
}

describe("paymentConfirmJob on hypercore", () => {
  const credit = (usdc: string, from = BUYER): LedgerUpdate => ({
    time: new Date("2026-09-29T14:10:00Z").getTime(),
    hash: HC_HASH,
    delta: { type: "internalTransfer", usdc, user: from.toLowerCase(), destination: OTHER.toLowerCase(), fee: "0.0" },
  });

  it("confirms a usdSend credit to payTo", async () => {
    const { ctx, stores } = setup({ HYPERCORE_ENABLED: "true", HYPERCORE_NETWORK: "mainnet" }, { hypercoreTransport: hyperliquid([credit("10.0")]) });
    await seedHyperCore(stores);
    expect(await paymentConfirmJob.run(ctx)).toEqual({ processed: 1, failed: 0 });
    expect(await stores.getPayment("pay_hc")).toMatchObject({ status: "confirmed", confirmations: 1 });
  });

  it("stays pending when underpaid, from another payer, or HyperCore is disabled", async () => {
    const under = setup({ HYPERCORE_ENABLED: "true" }, { hypercoreTransport: hyperliquid([credit("9.99")]) });
    await seedHyperCore(under.stores);
    expect(await paymentConfirmJob.run(under.ctx)).toEqual({ processed: 0, failed: 0 });

    const payer = setup({ HYPERCORE_ENABLED: "true" }, { hypercoreTransport: hyperliquid([credit("10")]) });
    await seedHyperCore(payer.stores, { payerAddress: "0x4444444444444444444444444444444444444444" });
    expect(await paymentConfirmJob.run(payer.ctx)).toEqual({ processed: 0, failed: 0 });

    const off = setup({}, { hypercoreTransport: hyperliquid([credit("10")]) });
    await seedHyperCore(off.stores);
    expect(await paymentConfirmJob.run(off.ctx)).toEqual({ processed: 0, failed: 0 });
    expect((await off.stores.getPayment("pay_hc"))?.status).toBe("pending");
  });
});

// --- Tempo memo ------------------------------------------------------------------

describe("paymentConfirmJob on Tempo with requireMemo", () => {
  const TEMPO = getEvmChain("tempo", "mainnet")!;
  const TX = `0x${"cd".repeat(32)}` as Hex;
  const pad = (hex: string): Hex => `0x${hex.replace(/^0x/, "").padStart(64, "0")}` as Hex;

  function tempoRpc(memo: Hex | null): FullEvmRpc {
    const topics: [Hex, ...Hex[]] =
      memo === null ? [TRANSFER_EVENT_TOPIC, pad(BUYER), pad(OTHER)] : [TRANSFER_WITH_MEMO_TOPIC, pad(BUYER), pad(OTHER), memo];
    return {
      getChainId: async () => TEMPO.chainId,
      getBlockNumber: async () => 200n,
      getBlockTimestamp: async () => BigInt(Math.floor(NOW.getTime() / 1000)),
      estimateFeesPerGas: async () => ({ maxFeePerGas: 1n, maxPriorityFeePerGas: 1n }),
      getTransactionReceipt: async (hash) =>
        hash === TX
          ? { transactionHash: TX, blockNumber: 100n, status: "success", from: BUYER, to: TEMPO.token.address, logs: [{ address: TEMPO.token.address, topics, data: pad((10_000_000).toString(16)), logIndex: 0 }] }
          : null,
    };
  }

  async function seedTempo(stores: InMemoryWorkerStore) {
    await stores.upsertCheckoutSession(session({ id: "cs_tempo", network: "tempo", payToAddress: OTHER, amount: money("10", "USDC"), requireMemo: true, route: undefined }));
    await stores.upsertPayment({
      id: "pay_tempo", organizationId: "org_1", checkoutSessionId: "cs_tempo", customerId: "cus_1", amount: money("10", "USDC"),
      network: "tempo", txHash: TX, confirmations: 0, status: "pending", createdAt: toIso(NOW),
    });
  }

  it("refuses a plain transfer and confirms transferWithMemo(keccak256(sessionId))", async () => {
    const env = { SETTLEKIT_CHAIN_ENV: "mainnet", ENABLED_EVM_CHAINS: "tempo" };
    const plain = setup(env, { evmRpcs: { tempo: tempoRpc(null) } });
    await seedTempo(plain.stores);
    expect(await paymentConfirmJob.run(plain.ctx)).toEqual({ processed: 0, failed: 0 });

    const memo = setup(env, { evmRpcs: { tempo: tempoRpc(sessionMemo("cs_tempo")) } });
    await seedTempo(memo.stores);
    expect(await paymentConfirmJob.run(memo.ctx)).toEqual({ processed: 1, failed: 0 });
  });
});
