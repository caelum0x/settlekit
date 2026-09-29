/**
 * EVM checkout confirmation over the shared @settlekit/chains verifier:
 * enabled chains confirm real (faked) receipts bound to the session; every
 * rule fails closed; unfinished transfers are claimed and resumed; the wallet
 * parameters come from the verified registry.
 */
import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { getEvmChain, sessionMemo, type Hex } from "@settlekit/chains";

import { CheckoutError } from "../lib/errors";
import { declareEvmPayer, getEvmPaymentParams } from "../lib/evm-checkout";
import { buildTransferCall, encodeTransferCall } from "../lib/evm-wallet";
import { getDeliveredAccess, recordAndConfirm } from "../lib/store";
import {
  BUYER_EVM,
  FIELDS,
  MERCHANT_EVM,
  OTHER_EVM,
  SESSION_CREATED,
  evmRuntime,
  fakeEvmRpc,
  harness,
  openSession,
  txHash,
  type FakeChainState,
} from "./harness";

const BASE = getEvmChain("base", "mainnet")!;
const TEMPO = getEvmChain("tempo", "mainnet")!;
const ROBINHOOD = getEvmChain("robinhood", "mainnet")!;
const ENV = { SETTLEKIT_CHAIN_ENV: "mainnet", ENABLED_EVM_CHAINS: "base,tempo,robinhood" };

function chains() {
  const base: FakeChainState = { chainId: BASE.chainId, token: BASE.token.address, head: 102n, txs: {} };
  const tempo: FakeChainState = { chainId: TEMPO.chainId, token: TEMPO.token.address, head: 100n, txs: {} };
  const robinhood: FakeChainState = { chainId: ROBINHOOD.chainId, token: ROBINHOOD.token.address, head: 110n, txs: {} };
  const evm = evmRuntime(ENV, { base: fakeEvmRpc(base), tempo: fakeEvmRpc(tempo), robinhood: fakeEvmRpc(robinhood) });
  return { base, tempo, robinhood, h: harness({ evm }) };
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

describe("EVM confirmation", () => {
  it("confirms a Base USDC transfer at the observed depth and delivers once", async () => {
    const { base, h } = chains();
    const session = await openSession(h, "base");
    base.txs[txHash(1)] = { transfers: [{ amountBase: 25_000_000n }] };

    const { payment, session: completed } = await recordAndConfirm(session.id, txHash(1), h.deps);
    expect(payment).toMatchObject({ status: "confirmed", network: "base", txHash: txHash(1), confirmations: 3 });
    expect(completed.status).toBe("completed");
    const access = await getDeliveredAccess(session.id, h.deps);
    expect(access[0]?.kind).toBe("license_key");
  });

  it("accepts an uppercase hash and stores it lowercase", async () => {
    const { base, h } = chains();
    const session = await openSession(h, "base");
    const hash = `0x${"AB".repeat(32)}`;
    base.txs[hash.toLowerCase()] = { transfers: [{ amountBase: 25_000_000n }] };
    const { payment } = await recordAndConfirm(session.id, hash, h.deps);
    expect(payment.txHash).toBe(hash.toLowerCase());
  });

  it.each([
    ["underpaid", { amountBase: 24_999_999n }, /expected at least/],
    ["wrong recipient", { amountBase: 25_000_000n, to: OTHER_EVM }, /no USDC transfer to the payTo/],
    ["wrong token", { amountBase: 25_000_000n, token: OTHER_EVM }, /no USDC transfer to the payTo/],
  ])("rejects a %s transfer and records nothing", async (_label, transfer, reason) => {
    const { base, h } = chains();
    const session = await openSession(h, "base");
    base.txs[txHash(2)] = { transfers: [transfer] };

    const error = await expectCode(recordAndConfirm(session.id, txHash(2), h.deps), "verification_failed");
    expect(error.message).toMatch(reason);
    expect(await h.payments.findByCheckoutSessionId(session.id)).toHaveLength(0);
  });

  it("rejects a reverted transaction", async () => {
    const { base, h } = chains();
    const session = await openSession(h, "base");
    base.txs[txHash(3)] = { transfers: [{ amountBase: 25_000_000n }], status: "reverted" };
    await expectCode(recordAndConfirm(session.id, txHash(3), h.deps), "verification_failed");
  });

  it("rejects a transfer mined before the session was created", async () => {
    const { base, h } = chains();
    const session = await openSession(h, "base");
    const before = Math.floor(SESSION_CREATED.getTime() / 1000) - 3_600;
    base.txs[txHash(4)] = { transfers: [{ amountBase: 25_000_000n }], blockTime: before };
    const error = await expectCode(recordAndConfirm(session.id, txHash(4), h.deps), "verification_failed");
    expect(error.message).toMatch(/before the checkout session/);
  });

  it("binds the declared payer", async () => {
    const { base, h } = chains();
    const session = await openSession(h, "base", { payerAddress: getAddress(OTHER_EVM) });
    base.txs[txHash(5)] = { transfers: [{ amountBase: 25_000_000n, from: BUYER_EVM }] };
    const error = await expectCode(recordAndConfirm(session.id, txHash(5), h.deps), "verification_failed");
    expect(error.message).toMatch(/declared payer/);
  });

  it("is pending while unmined and claims nothing", async () => {
    const { h } = chains();
    const session = await openSession(h, "base");
    await expectCode(recordAndConfirm(session.id, txHash(6), h.deps), "payment_pending");
    expect(await h.payments.findByCheckoutSessionId(session.id)).toHaveLength(0);
  });

  it("claims a valid transfer awaiting confirmations and settles the same payment later", async () => {
    const { base, h } = chains();
    const session = await openSession(h, "base");
    base.head = 100n; // 1 confirmation < 3
    base.txs[txHash(7)] = { transfers: [{ amountBase: 25_000_000n }] };

    const error = await expectCode(recordAndConfirm(session.id, txHash(7), h.deps), "payment_pending");
    expect(error.status).toBe(425);
    const claimed = await h.payments.findByCheckoutSessionId(session.id);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ status: "pending", txHash: txHash(7) });

    // No other session can use the claimed hash.
    const other = await openSession(h, "base");
    await expectCode(recordAndConfirm(other.id, txHash(7), h.deps), "duplicate_tx");

    base.head = 105n;
    const { payment } = await recordAndConfirm(session.id, txHash(7), h.deps);
    expect(payment.id).toBe(claimed[0]?.id);
    expect(payment.status).toBe("confirmed");
  });

  it("fails closed on a chain that is not enabled", async () => {
    const { h } = chains();
    const session = await openSession(h, "ethereum");
    const error = await expectCode(recordAndConfirm(session.id, txHash(8), h.deps), "verification_failed");
    expect(error.message).toMatch(/ENABLED_EVM_CHAINS/);
  });

  it("fails closed when the RPC serves another chain", async () => {
    const base: FakeChainState = { chainId: 1, token: BASE.token.address, head: 200n, txs: {} };
    base.txs[txHash(9)] = { transfers: [{ amountBase: 25_000_000n }] };
    const h = harness({ evm: evmRuntime(ENV, { base: fakeEvmRpc(base) }) });
    const session = await openSession(h, "base");
    const error = await expectCode(recordAndConfirm(session.id, txHash(9), h.deps), "verification_failed");
    expect(error.message).toMatch(/chain id mismatch/);
  });

  it("surfaces a broken chain configuration instead of passing", async () => {
    const h = harness({ evm: evmRuntime({ ENABLED_EVM_CHAINS: "base,notachain" }, {}) });
    const session = await openSession(h, "base");
    const error = await expectCode(recordAndConfirm(session.id, txHash(10), h.deps), "verification_failed");
    expect(error.message).toMatch(/unknown chain/);
  });

  it("settles Tempo only with the session memo", async () => {
    const { tempo, h } = chains();
    const session = await openSession(h, "tempo");
    tempo.txs[txHash(11)] = { transfers: [{ amountBase: 25_000_000n, memo: sessionMemo("cs_someone_else") }] };
    const error = await expectCode(recordAndConfirm(session.id, txHash(11), h.deps), "verification_failed");
    expect(error.message).toMatch(/memo/);

    tempo.txs[txHash(12)] = {
      transfers: [
        // Tempo's fee transfer from the payer goes elsewhere and is ignored.
        { amountBase: 1_000n, to: OTHER_EVM },
        { amountBase: 25_000_000n, memo: sessionMemo(session.id) },
      ],
    };
    const { payment } = await recordAndConfirm(session.id, txHash(12), h.deps);
    expect(payment.status).toBe("confirmed");
  });

  it("requires transferWithMemo on Tempo when the session demands it", async () => {
    const { tempo, h } = chains();
    const session = await openSession(h, "tempo", { requireMemo: true });
    expect((await getEvmPaymentParams(session.id, h.deps)).memoRequired).toBe(true);

    // A plain transfer paying the full amount to payTo is refused...
    tempo.txs[txHash(21)] = { transfers: [{ amountBase: 25_000_000n }] };
    const error = await expectCode(recordAndConfirm(session.id, txHash(21), h.deps), "verification_failed");
    expect(error.message).toMatch(/transferWithMemo/);

    // ...while the same payment with keccak256(sessionId) as memo settles.
    tempo.txs[txHash(22)] = { transfers: [{ amountBase: 25_000_000n, memo: sessionMemo(session.id) }] };
    const { payment } = await recordAndConfirm(session.id, txHash(22), h.deps);
    expect(payment.status).toBe("confirmed");
  });

  it("accepts a plain Tempo transfer when the memo is not required", async () => {
    const { tempo, h } = chains();
    const session = await openSession(h, "tempo");
    expect((await getEvmPaymentParams(session.id, h.deps)).memoRequired).toBe(false);
    tempo.txs[txHash(23)] = { transfers: [{ amountBase: 25_000_000n }] };
    expect((await recordAndConfirm(session.id, txHash(23), h.deps)).payment.status).toBe("confirmed");
  });

  it("settles Robinhood Chain in USDG", async () => {
    const { robinhood, h } = chains();
    const session = await openSession(h, "robinhood");
    robinhood.txs[txHash(13)] = { transfers: [{ amountBase: 25_000_000n }] };
    const { payment } = await recordAndConfirm(session.id, txHash(13), h.deps);
    expect(payment.network).toBe("robinhood");
  });
});

describe("EVM wallet parameters", () => {
  it("returns registry chain params with the PUBLIC RPC, exact amount and checksummed payTo", async () => {
    const env = { ...ENV, TEMPO_RPC_URL: "https://rpc.example/secret-api-key" };
    const tempo: FakeChainState = { chainId: TEMPO.chainId, token: TEMPO.token.address, head: 1n, txs: {} };
    const h = harness({ evm: evmRuntime(env, { tempo: fakeEvmRpc(tempo) }) });
    const session = await openSession(h, "tempo", { payToAddress: MERCHANT_EVM.toLowerCase() });

    const params = await getEvmPaymentParams(session.id, h.deps);
    expect(params).toMatchObject({
      network: "tempo",
      chainId: 4217,
      token: { address: TEMPO.token.address, symbol: "USDC.e", decimals: 6 },
      amount: "25",
      amountBase: "25000000",
      payTo: getAddress(MERCHANT_EVM),
      memo: sessionMemo(session.id),
      minConfirmations: 1,
      explorerTxBase: "https://explore.tempo.xyz/tx/",
    });
    expect(params.addChain).toMatchObject({
      chainId: "0x1079",
      rpcUrls: ["https://rpc.tempo.xyz"],
      blockExplorerUrls: ["https://explore.tempo.xyz"],
    });
    expect(JSON.stringify(params)).not.toContain("secret-api-key");

    // The memo transfer the wallet signs carries exactly these values.
    const call = buildTransferCall({ token: params.token.address, payTo: params.payTo, amountBase: params.amountBase, memo: params.memo });
    expect(call.functionName).toBe("transferWithMemo");
    expect(encodeTransferCall(call).slice(0, 10)).not.toBe("0xa9059cbb");
  });

  it("uses a plain ERC-20 transfer off Tempo and labels Robinhood USDG", async () => {
    const { h } = chains();
    const session = await openSession(h, "robinhood");
    const params = await getEvmPaymentParams(session.id, h.deps);
    expect(params.token.symbol).toBe("USDG");
    expect(params.memo).toBeNull();
    const call = buildTransferCall({ token: params.token.address, payTo: params.payTo, amountBase: params.amountBase, memo: null });
    expect(encodeTransferCall(call).slice(0, 10)).toBe("0xa9059cbb");
  });

  it("refuses params for a chain this checkout cannot verify", async () => {
    const { h } = chains();
    const session = await openSession(h, "arbitrum");
    await expectCode(getEvmPaymentParams(session.id, h.deps), "network_not_configured");
  });

  it("binds the connected wallet as payer and saves delivery fields", async () => {
    const { base, h } = chains();
    const session = await openSession(h, "base", { collectedFields: {} });
    await expectCode(
      declareEvmPayer({ sessionId: session.id, payer: "not-an-address", fields: FIELDS }, h.deps),
      "invalid_request",
    );
    await expectCode(declareEvmPayer({ sessionId: session.id, payer: BUYER_EVM, fields: {} }, h.deps), "fields_incomplete");

    const { payerAddress } = await declareEvmPayer({ sessionId: session.id, payer: BUYER_EVM, fields: FIELDS }, h.deps);
    expect(payerAddress).toBe(getAddress(BUYER_EVM));
    const saved = await h.checkouts.findById(session.id);
    expect(saved).toMatchObject({ payerAddress, collectedFields: FIELDS });

    // A transfer from another wallet no longer settles this session.
    base.txs[txHash(14)] = { transfers: [{ amountBase: 25_000_000n, from: OTHER_EVM as Hex }] };
    await expectCode(recordAndConfirm(session.id, txHash(14), h.deps), "verification_failed");
  });
});
