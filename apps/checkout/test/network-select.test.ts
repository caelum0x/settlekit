/**
 * Buyer network selection: only accepted + configured networks, never after a
 * payment is recorded, payTo pinned per network, Zcash quote locked once, and
 * the picker options / demo seed / CSRF guard that surround it.
 */
import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { getEvmChain } from "@settlekit/chains";
import type { PaymentNetwork } from "@settlekit/common";

import { CheckoutError } from "../lib/errors";
import { buildNetworkOptions } from "../lib/network-options";
import { selectNetwork } from "../lib/network-select";
import { assertSameOrigin } from "../lib/same-origin";
import { DEMO_EVM_PAY_TO, demoPaymentRouting, seedCatalog } from "../lib/seed";
import { recordAndConfirm } from "../lib/store";
import {
  MERCHANT_EVM,
  OTHER_EVM,
  SESSION_CREATED,
  ZEC_PAY_TO,
  evmRuntime,
  fakeEvmRpc,
  fakeExplorer,
  fixedPrice,
  harness,
  openSession,
  txHash,
  zcashRuntime,
  type FakeChainState,
} from "./harness";

const BASE = getEvmChain("base", "testnet")!;
const TEMPO = getEvmChain("tempo", "testnet")!;
const ENV = { SETTLEKIT_CHAIN_ENV: "testnet", ENABLED_EVM_CHAINS: "base,tempo" };
const ALL: PaymentNetwork[] = ["base", "tempo", "arbitrum", "zcash", "solana"];
const TEMPO_PAY_TO = getAddress(OTHER_EVM);
const NOW = new Date(SESSION_CREATED.getTime() + 60_000);
/** Price observation clock (quotes refuse prices older than 60 s). */
let clock = NOW;

function setup(options: { zcash?: boolean } = {}) {
  const base: FakeChainState = { chainId: BASE.chainId, token: BASE.token.address, head: 110n, txs: {} };
  const tempo: FakeChainState = { chainId: TEMPO.chainId, token: TEMPO.token.address, head: 110n, txs: {} };
  const explorer = { txs: {}, activity: [], calls: [] as string[] };
  const h = harness({
    evm: evmRuntime(ENV, { base: fakeEvmRpc(base), tempo: fakeEvmRpc(tempo) }),
    ...(options.zcash === false ? {} : { zcash: zcashRuntime(fakeExplorer(explorer), [fixedPrice("50", "coinbase", () => clock)]) }),
  });
  return { h, base, tempo };
}

async function multiSession(h: ReturnType<typeof setup>["h"]) {
  return openSession(h, "base", {
    acceptedNetworks: ALL,
    payToByNetwork: { tempo: TEMPO_PAY_TO, zcash: ZEC_PAY_TO },
  });
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

describe("selectNetwork", () => {
  it("switches to another accepted network with its own payTo and back to the default", async () => {
    const { h } = setup();
    const session = await multiSession(h);

    const onTempo = await selectNetwork(session.id, "tempo", h.deps, NOW);
    expect(onTempo).toMatchObject({ network: "tempo", payToAddress: TEMPO_PAY_TO });

    const back = await selectNetwork(session.id, "base", h.deps, NOW);
    expect(back).toMatchObject({ network: "base", payToAddress: MERCHANT_EVM });
    expect(back.payToByNetwork).toMatchObject({ base: MERCHANT_EVM, tempo: TEMPO_PAY_TO, zcash: ZEC_PAY_TO });
  });

  it("rejects a network the merchant did not accept", async () => {
    const { h } = setup();
    const session = await openSession(h, "base", { acceptedNetworks: ["base", "tempo"] });
    const error = await expectCode(selectNetwork(session.id, "ethereum", h.deps, NOW), "network_not_accepted");
    expect(error.status).toBe(422);
    expect((await h.checkouts.findById(session.id))?.network).toBe("base");
  });

  it("rejects an accepted network this checkout cannot verify (fail closed)", async () => {
    const { h } = setup();
    const session = await multiSession(h);
    await expectCode(selectNetwork(session.id, "arbitrum", h.deps, NOW), "network_not_configured");
    await expectCode(selectNetwork(session.id, "solana", h.deps, NOW), "network_not_configured");
  });

  it("rejects unknown network names", async () => {
    const { h } = setup();
    const session = await multiSession(h);
    await expectCode(selectNetwork(session.id, "dogecoin", h.deps, NOW), "invalid_request");
    await expectCode(selectNetwork(session.id, 42, h.deps, NOW), "invalid_request");
  });

  it("cannot switch once a payment is claimed or settled", async () => {
    const { h, base } = setup();
    const session = await multiSession(h);
    base.head = 100n; // 1 confirmation: the transfer is claimed but pending
    base.txs[txHash(1)] = { transfers: [{ amountBase: 25_000_000n }] };
    await expectCode(recordAndConfirm(session.id, txHash(1), h.deps), "payment_pending");

    const error = await expectCode(selectNetwork(session.id, "tempo", h.deps, NOW), "session_not_payable");
    expect(error.message).toMatch(/already recorded/);

    base.head = 110n;
    await recordAndConfirm(session.id, txHash(1), h.deps);
    const paid = await expectCode(selectNetwork(session.id, "tempo", h.deps, NOW), "session_not_payable");
    expect(paid.message).toMatch(/already been paid/);
  });

  it("clears a payer declared for another chain", async () => {
    const { h } = setup();
    const session = await multiSession(h);
    await h.checkouts.save({ ...session, payerAddress: getAddress(OTHER_EVM) });
    const switched = await selectNetwork(session.id, "tempo", h.deps, NOW);
    expect(switched.payerAddress).toBeUndefined();
    const same = await selectNetwork(session.id, "tempo", h.deps, NOW);
    expect(same.network).toBe("tempo");
  });

  it("locks a ZEC quote once and keeps it while live", async () => {
    const { h } = setup();
    const session = await multiSession(h);
    const first = await selectNetwork(session.id, "zcash", h.deps, NOW);
    expect(first.network).toBe("zcash");
    expect(first.payToAddress).toBe(ZEC_PAY_TO);
    // 25 USD at 50 USD/ZEC = 0.5 ZEC = 50_000_000 zats, plus a tag < 10_000.
    const zats = BigInt(first.settlementQuote!.amountBase);
    expect(zats >= 50_000_000n && zats < 50_010_000n).toBe(true);
    expect(first.settlementQuote).toMatchObject({ asset: "ZEC", rate: "50", source: "coinbase" });

    await selectNetwork(session.id, "base", h.deps, NOW);
    const again = await selectNetwork(session.id, "zcash", h.deps, new Date(NOW.getTime() + 60_000));
    expect(again.settlementQuote).toEqual(first.settlementQuote);

    const later = new Date(NOW.getTime() + 16 * 60_000);
    clock = later;
    const relocked = await selectNetwork(session.id, "zcash", h.deps, later);
    clock = NOW;
    expect(relocked.settlementQuote?.lockedAt).toBe(later.toISOString());
  });

  it("gives concurrent sessions on one address distinct amount tags", async () => {
    const { h } = setup();
    const quotes = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const session = await multiSession(h);
      const locked = await selectNetwork(session.id, "zcash", h.deps, NOW);
      quotes.add(locked.settlementQuote!.amountBase);
    }
    expect(quotes.size).toBe(5);
  });

  it("refuses Zcash when it is not enabled and when prices cannot be locked", async () => {
    const disabled = setup({ zcash: false });
    const session = await multiSession(disabled.h);
    await expectCode(selectNetwork(session.id, "zcash", disabled.h.deps, NOW), "network_not_configured");

    const explorer = { txs: {}, activity: [], calls: [] as string[] };
    const failing = harness({
      zcash: zcashRuntime(fakeExplorer(explorer), [{ name: "coinbase", fetchUsdPrice: async () => Promise.reject(new Error("down")) }]),
    });
    const zSession = await openSession(failing, "base", { acceptedNetworks: ["base", "zcash"], payToByNetwork: { zcash: ZEC_PAY_TO } });
    const error = await expectCode(selectNetwork(zSession.id, "zcash", failing.deps, NOW), "quote_unavailable");
    expect(error.status).toBe(502);
    expect((await failing.checkouts.findById(zSession.id))?.network).toBe("base");
  });
});

describe("network options", () => {
  it("lists only accepted networks this checkout can verify, with honest labels", async () => {
    const { h } = setup();
    const session = await multiSession(h);
    const options = buildNetworkOptions(session, h.deps.verify);
    const available = options.filter((option) => option.available).map((option) => option.network);
    expect(available).toEqual(["base", "tempo", "zcash"]);
    expect(options.find((o) => o.network === "tempo")).toMatchObject({ asset: "pathUSD", badges: ["testnet"], env: "testnet" });
    expect(options.find((o) => o.network === "zcash")).toMatchObject({ asset: "ZEC", badges: ["transparent"] });
    expect(options.find((o) => o.network === "arbitrum")?.unavailableReason).toMatch(/ENABLED_EVM_CHAINS/);
  });

  it("hides a network whose payTo is invalid for it", async () => {
    const { h } = setup();
    const session = await openSession(h, "base", { acceptedNetworks: ["base", "zcash"] });
    const zcash = buildNetworkOptions(session, h.deps.verify).find((o) => o.network === "zcash");
    expect(zcash?.available).toBe(false);
  });

  it("never offers the demo placeholder address on a mainnet", async () => {
    const mainnet = harness({ evm: evmRuntime({ SETTLEKIT_CHAIN_ENV: "mainnet", ENABLED_EVM_CHAINS: "base" }, {}) });
    const session = await openSession(mainnet, "base", { payToAddress: DEMO_EVM_PAY_TO });
    const option = buildNetworkOptions(session, mainnet.deps.verify)[0];
    expect(option).toMatchObject({ network: "base", available: false });
    expect(option?.unavailableReason).toMatch(/test networks/);

    const testnet = harness({ evm: evmRuntime(ENV, {}) });
    const demo = await openSession(testnet, "base", { payToAddress: DEMO_EVM_PAY_TO });
    expect(buildNetworkOptions(demo, testnet.deps.verify)[0]?.available).toBe(true);
  });
});

describe("demo seed", () => {
  it("accepts every EVM chain and adds Solana / Zcash only with a configured address", () => {
    const bare = demoPaymentRouting({});
    expect(bare.payToAddress).toBe(DEMO_EVM_PAY_TO);
    expect(bare.acceptedNetworks).toEqual(["base", "ethereum", "arbitrum", "robinhood", "hyperevm", "tempo", "arc"]);
    expect(bare.payToByNetwork).toEqual({});

    const full = demoPaymentRouting({
      CHECKOUT_DEMO_SOLANA_PAY_TO: "7Vb9wYx3rKq4H1TzGmP2dN8sFcQeR5uJ6kLpXaBnMo1w",
      CHECKOUT_DEMO_ZCASH_PAY_TO: ZEC_PAY_TO,
    });
    expect(full.acceptedNetworks).toContain("solana");
    expect(full.acceptedNetworks).toContain("zcash");
    expect(full.payToByNetwork.zcash).toBe(ZEC_PAY_TO);

    const catalog = seedCatalog({});
    expect(catalog.products.every((item) => item.acceptedNetworks.length === 7 && item.network === "base")).toBe(true);
  });
});

describe("assertSameOrigin", () => {
  const post = (headers: Record<string, string>) =>
    new Request("https://checkout.example/api/v1/checkout-sessions/cs_1/network", { method: "POST", headers });

  it("allows same-origin and header-less requests", () => {
    expect(() => assertSameOrigin(post({ origin: "https://checkout.example", host: "checkout.example" }))).not.toThrow();
    expect(() => assertSameOrigin(post({}))).not.toThrow();
    expect(() => assertSameOrigin(post({ origin: "https://pay.acme.dev", "x-forwarded-host": "pay.acme.dev" }))).not.toThrow();
  });

  it("refuses cross-site requests", () => {
    expect(() => assertSameOrigin(post({ origin: "https://evil.example", host: "checkout.example" }))).toThrow(CheckoutError);
    expect(() => assertSameOrigin(post({ "sec-fetch-site": "cross-site" }))).toThrow(/Cross-site/);
    expect(() => assertSameOrigin(post({ origin: "null", host: "checkout.example" }))).toThrow(CheckoutError);
  });
});
