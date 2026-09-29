/**
 * Worker multi-chain verification: every EVM chain routes through
 * @settlekit/chains (enabled -> confirms, disabled -> stays pending), Zcash
 * payments verify against the locked quote (late -> manual review), and the
 * zcash-watch job attaches matching txids with one explorer call per payTo.
 */
import { describe, expect, it } from "vitest";
import { money, toIso, type CheckoutSession, type Payment, type PaymentNetwork, type SettlementQuote } from "@settlekit/common";
import { TRANSFER_EVENT_TOPIC, type FullEvmRpc, type Hex } from "@settlekit/arc";
import { getEvmChain, type EvmChainKey } from "@settlekit/chains";
import type { ZcashAddressActivity, ZcashExplorer, ZcashTransaction } from "@settlekit/zcash";
import type { GitHubApi } from "@settlekit/github";
import type { DiscordApi } from "@settlekit/discord";
import { loadConfig } from "../src/config.js";
import { buildJobContext } from "../src/runtime.js";
import { InMemoryWorkerStore } from "../src/stores.js";
import { paymentConfirmJob } from "../src/jobs/payment-confirm-job.js";
import { zcashWatchJob } from "../src/jobs/zcash-watch.js";

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
const MERCHANT = "0x3333333333333333333333333333333333333333" as Hex;
const BUYER = "0x2222222222222222222222222222222222222222" as Hex;
const TX = `0x${"cd".repeat(32)}` as Hex;
const ZEC_PAY_TO = "t1Ne88F8ouCV92brDXNBB47a85brvnEHE8g";
const ZEC_TXID = "ef".repeat(32);

const pad = (hex: string): Hex => `0x${hex.replace(/^0x/, "").padStart(64, "0")}` as Hex;

function paidRpc(chainId: number, token: Hex, amountBase: bigint): FullEvmRpc {
  return {
    getChainId: async () => chainId,
    getBlockNumber: async () => 200n,
    getBlockTimestamp: async () => BigInt(Math.floor(Date.now() / 1000)),
    estimateFeesPerGas: async () => ({ maxFeePerGas: 1n, maxPriorityFeePerGas: 1n }),
    getTransactionReceipt: async (hash) =>
      hash === TX
        ? {
            transactionHash: TX,
            blockNumber: 100n,
            status: "success",
            from: BUYER,
            to: token,
            logs: [{ address: token, topics: [TRANSFER_EVENT_TOPIC, pad(BUYER), pad(MERCHANT)], data: pad(amountBase.toString(16)), logIndex: 0 }],
          }
        : null,
  };
}

function quote(amountBase: string, expiresAt: Date): SettlementQuote {
  return { asset: "ZEC", amountBase, decimals: 8, rate: "1438.25", source: "coinbase", lockedAt: toIso(new Date(expiresAt.getTime() - 900_000)), expiresAt: toIso(expiresAt) };
}

function fakeExplorer(tx: Partial<ZcashTransaction> | null, activity: ZcashAddressActivity[] = []): ZcashExplorer & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getTransaction: async (txid) => {
      calls.push(`tx:${txid}`);
      return { ok: true, value: tx === null ? null : { txid, blockHeight: 10, blockTime: new Date(), confirmations: 5, outputs: [], inputAddresses: [], ...tx } };
    },
    getAddressActivity: async (address) => {
      calls.push(`addr:${address}`);
      return { ok: true, value: activity };
    },
  };
}

function setup(env: Record<string, string>, extras: { evmRpcs?: Partial<Record<EvmChainKey, FullEvmRpc>>; zcashExplorer?: ZcashExplorer } = {}) {
  const stores = new InMemoryWorkerStore();
  const { ctx } = buildJobContext({
    config: loadConfig({ ...ENV, ...env }),
    githubApi: {} as GitHubApi,
    discordApi: {} as DiscordApi,
    emailTransport: { send: async () => ({ id: "email_1" }) },
    stores,
    ...extras,
  });
  return { ctx, stores };
}

async function seed(stores: InMemoryWorkerStore, network: PaymentNetwork, payTo: string, txHash: string | undefined, extra: Partial<CheckoutSession> = {}): Promise<Payment> {
  const now = new Date();
  await stores.upsertCheckoutSession({
    id: `cs_${network}`, organizationId: "org_1", merchantId: "mch_1", customerId: "cus_1", lineItems: [], amount: money("10", "USDC"),
    status: "open", payToAddress: payTo, network, expiresAt: toIso(new Date(now.getTime() + 86_400_000)), collectedFields: {},
    createdAt: toIso(now), ...extra,
  });
  return stores.upsertPayment({
    id: `pay_${network}`, organizationId: "org_1", checkoutSessionId: `cs_${network}`, customerId: "cus_1", amount: money("10", "USDC"),
    network, ...(txHash !== undefined ? { txHash } : {}), confirmations: 0, status: "pending", createdAt: toIso(now),
  });
}

const EVM_CASES: EvmChainKey[] = ["ethereum", "base", "arbitrum", "robinhood", "hyperevm", "tempo"];

describe.each(EVM_CASES)("paymentConfirmJob on %s", (key) => {
  const spec = getEvmChain(key, "testnet")!;

  it("confirms when the chain is enabled and the transfer pays the session", async () => {
    const { ctx, stores } = setup({ ENABLED_EVM_CHAINS: key }, { evmRpcs: { [key]: paidRpc(spec.chainId, spec.token.address, 10_000_000n) } });
    await seed(stores, key, MERCHANT, TX);
    expect(await paymentConfirmJob.run(ctx)).toEqual({ processed: 1, failed: 0 });
    expect((await stores.getPayment(`pay_${key}`))?.status).toBe("confirmed");
  });

  it("stays pending when the chain is not enabled (fail closed)", async () => {
    const { ctx, stores } = setup({}, { evmRpcs: { [key]: paidRpc(spec.chainId, spec.token.address, 10_000_000n) } });
    await seed(stores, key, MERCHANT, TX);
    expect(await paymentConfirmJob.run(ctx)).toEqual({ processed: 0, failed: 0 });
    expect((await stores.getPayment(`pay_${key}`))?.status).toBe("pending");
  });

  it("stays pending on underpayment or the wrong token", async () => {
    const under = setup({ ENABLED_EVM_CHAINS: key }, { evmRpcs: { [key]: paidRpc(spec.chainId, spec.token.address, 9_999_999n) } });
    await seed(under.stores, key, MERCHANT, TX);
    expect(await paymentConfirmJob.run(under.ctx)).toEqual({ processed: 0, failed: 0 });
    const fake = setup({ ENABLED_EVM_CHAINS: key }, { evmRpcs: { [key]: paidRpc(spec.chainId, "0x9999999999999999999999999999999999999999", 10_000_000n) } });
    await seed(fake.stores, key, MERCHANT, TX);
    expect(await paymentConfirmJob.run(fake.ctx)).toEqual({ processed: 0, failed: 0 });
  });
});

describe("paymentConfirmJob on arc (same EVM path)", () => {
  it("confirms Arc via the chains registry when ARC_CHAIN_ID is the registry chain", async () => {
    const token = "0x3600000000000000000000000000000000000000" as Hex;
    const { ctx, stores } = setup({ ARC_CHAIN_ID: "5042002" }, { evmRpcs: { arc: paidRpc(5_042_002, token, 10_000_000n) } });
    await seed(stores, "arc", MERCHANT, TX);
    expect(await paymentConfirmJob.run(ctx)).toEqual({ processed: 1, failed: 0 });
  });

  it("fails closed when the Arc RPC serves another chain", async () => {
    const token = "0x3600000000000000000000000000000000000000" as Hex;
    const { ctx, stores } = setup({ ARC_CHAIN_ID: "5042002" }, { evmRpcs: { arc: paidRpc(1, token, 10_000_000n) } });
    await seed(stores, "arc", MERCHANT, TX);
    expect(await paymentConfirmJob.run(ctx)).toEqual({ processed: 0, failed: 0 });
  });
});

describe("paymentConfirmJob on zcash", () => {
  const future = () => new Date(Date.now() + 600_000);

  it("confirms an exact, confirmed payment against the locked quote", async () => {
    const explorer = fakeExplorer({ outputs: [{ recipient: ZEC_PAY_TO, value: 695_311n }] });
    const { ctx, stores } = setup({ ZCASH_ENABLED: "true" }, { zcashExplorer: explorer });
    await seed(stores, "zcash", ZEC_PAY_TO, ZEC_TXID, { settlementQuote: quote("695311", future()) });
    expect(await paymentConfirmJob.run(ctx)).toEqual({ processed: 1, failed: 0 });
  });

  it("holds a late payment for manual review and a wrong amount as pending", async () => {
    const late = fakeExplorer({ outputs: [{ recipient: ZEC_PAY_TO, value: 695_311n }] });
    const a = setup({ ZCASH_ENABLED: "true" }, { zcashExplorer: late });
    await seed(a.stores, "zcash", ZEC_PAY_TO, ZEC_TXID, { settlementQuote: quote("695311", new Date(Date.now() - 3_600_000)), createdAt: toIso(new Date(Date.now() - 4_000_000)) });
    expect(await paymentConfirmJob.run(a.ctx)).toEqual({ processed: 0, failed: 0 });
    expect((await a.stores.getPayment("pay_zcash"))?.status).toBe("pending");

    const wrong = fakeExplorer({ outputs: [{ recipient: ZEC_PAY_TO, value: 695_310n }] });
    const b = setup({ ZCASH_ENABLED: "true" }, { zcashExplorer: wrong });
    await seed(b.stores, "zcash", ZEC_PAY_TO, ZEC_TXID, { settlementQuote: quote("695311", future()) });
    expect(await paymentConfirmJob.run(b.ctx)).toEqual({ processed: 0, failed: 0 });
  });

  it("stays pending when Zcash is not enabled", async () => {
    const { ctx, stores } = setup({});
    await seed(stores, "zcash", ZEC_PAY_TO, ZEC_TXID, { settlementQuote: quote("695311", future()) });
    expect(await paymentConfirmJob.run(ctx)).toEqual({ processed: 0, failed: 0 });
  });
});

describe("zcashWatchJob", () => {
  const future = () => new Date(Date.now() + 600_000);
  const incoming = (amount: bigint, txid = ZEC_TXID): ZcashAddressActivity => ({ txid, blockHeight: 10, blockTime: new Date(), balanceChange: amount });

  it("makes no explorer call when no open zcash session exists", async () => {
    const explorer = fakeExplorer(null);
    const { ctx, stores } = setup({ ZCASH_ENABLED: "true" }, { zcashExplorer: explorer });
    await seed(stores, "base", MERCHANT, undefined);
    expect(await zcashWatchJob.run(ctx)).toEqual({ processed: 0, failed: 0 });
    expect(explorer.calls).toEqual([]);
  });

  it("attaches the matching txid to the pending payment, then confirm settles it", async () => {
    const explorer = fakeExplorer({ outputs: [{ recipient: ZEC_PAY_TO, value: 695_311n }] }, [incoming(1n, "aa".repeat(32)), incoming(695_311n)]);
    const { ctx, stores } = setup({ ZCASH_ENABLED: "true" }, { zcashExplorer: explorer });
    await seed(stores, "zcash", ZEC_PAY_TO, undefined, { settlementQuote: quote("695311", future()) });
    expect(await zcashWatchJob.run(ctx)).toEqual({ processed: 1, failed: 0 });
    expect(explorer.calls).toEqual([`addr:${ZEC_PAY_TO}`]);
    expect((await stores.getPayment("pay_zcash"))?.txHash).toBe(ZEC_TXID);
    expect(await paymentConfirmJob.run(ctx)).toEqual({ processed: 1, failed: 0 });
    expect(await zcashWatchJob.run(ctx)).toEqual({ processed: 0, failed: 0 });
  });

  it("records a pending payment when the session has none yet, and never reuses a txid", async () => {
    const explorer = fakeExplorer(null, [incoming(695_311n)]);
    const { ctx, stores } = setup({ ZCASH_ENABLED: "true" }, { zcashExplorer: explorer });
    await stores.upsertCheckoutSession({
      id: "cs_new", organizationId: "org_1", merchantId: "mch_1", customerId: "cus_9", lineItems: [], amount: money("10", "USDC"),
      status: "open", payToAddress: ZEC_PAY_TO, network: "zcash", expiresAt: toIso(future()), collectedFields: {},
      createdAt: toIso(new Date()), settlementQuote: quote("695311", future()),
    });
    expect(await zcashWatchJob.run(ctx)).toEqual({ processed: 1, failed: 0 });
    const recorded = await stores.paymentByTxHash(ZEC_TXID);
    expect(recorded).toMatchObject({ checkoutSessionId: "cs_new", network: "zcash", status: "pending", customerId: "cus_9" });
    expect(await zcashWatchJob.run(ctx)).toEqual({ processed: 0, failed: 0 });
  });

  it("stops watching an hour after the quote expired and reports explorer outages", async () => {
    const stale = setup({ ZCASH_ENABLED: "true" }, { zcashExplorer: fakeExplorer(null, [incoming(695_311n)]) });
    await seed(stale.stores, "zcash", ZEC_PAY_TO, undefined, { settlementQuote: quote("695311", new Date(Date.now() - 3_700_000)) });
    expect(await zcashWatchJob.run(stale.ctx)).toEqual({ processed: 0, failed: 0 });

    const down: ZcashExplorer = { ...fakeExplorer(null), getAddressActivity: async () => ({ ok: false, retryLater: true, status: 429, reason: "rate limited" }) };
    const outage = setup({ ZCASH_ENABLED: "true" }, { zcashExplorer: down });
    await seed(outage.stores, "zcash", ZEC_PAY_TO, undefined, { settlementQuote: quote("695311", future()) });
    expect(await zcashWatchJob.run(outage.ctx)).toEqual({ processed: 0, failed: 1 });
  });
});
