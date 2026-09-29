/**
 * Transparent Zcash checkout: ZIP-321 request for the locked quote, payment
 * discovery by exact tagged amount with one cached address call per payTo,
 * confirmation depth, pasted txids, late payments held for review, and fail
 * closed when Zcash is disabled.
 */
import { describe, expect, it } from "vitest";

import { CheckoutError } from "../lib/errors";
import { recordAndConfirm } from "../lib/store";
import { createAddressActivityCache } from "../lib/zcash";
import { getZcashStatus, prepareZcashPayment } from "../lib/zcash-checkout";
import {
  FIELDS,
  SESSION_CREATED,
  ZEC_PAYER,
  ZEC_PAY_TO,
  fakeExplorer,
  harness,
  lockedQuote,
  openSession,
  zcashRuntime,
  type FakeExplorerState,
} from "./harness";

const LOCKED_AT = new Date(SESSION_CREATED.getTime() + 30_000);
const AMOUNT = "50004321"; // 0.5 ZEC for 25 USD at 50 USD/ZEC + tag 4321
const TXID = "ab".repeat(32);
const MINED = new Date(LOCKED_AT.getTime() + 5 * 60_000);

function setup() {
  const explorer: FakeExplorerState = { txs: {}, activity: [], calls: [] };
  const h = harness({ zcash: zcashRuntime(fakeExplorer(explorer)) });
  const cache = createAddressActivityCache();
  return { h, explorer, cache };
}

async function zcashSession(h: ReturnType<typeof setup>["h"], overrides = {}) {
  return openSession(h, "zcash", { settlementQuote: lockedQuote(AMOUNT, LOCKED_AT), ...overrides });
}

function payTx(overrides: Record<string, unknown> = {}) {
  return {
    blockTime: MINED,
    confirmations: 5,
    outputs: [{ recipient: ZEC_PAY_TO, value: BigInt(AMOUNT) }],
    inputAddresses: [ZEC_PAYER],
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

describe("Zcash payment request", () => {
  it("returns the ZIP-321 URI for the exact locked amount and saves delivery fields", async () => {
    const { h } = setup();
    const session = await zcashSession(h, { collectedFields: {} });
    await expectCode(prepareZcashPayment({ sessionId: session.id, fields: {} }, h.deps, LOCKED_AT), "fields_incomplete");

    const request = await prepareZcashPayment({ sessionId: session.id, fields: FIELDS }, h.deps, LOCKED_AT);
    expect(request).toMatchObject({
      uri: `zcash:${ZEC_PAY_TO}?amount=0.50004321&label=Acme%20Dev%20Tools&message=Atlas%20Desktop%20Pro`,
      address: ZEC_PAY_TO,
      amountZec: "0.50004321",
      amountZats: AMOUNT,
      usdAmount: "25",
      quoteExpired: false,
      minConfirmations: 3,
    });
    expect(request.uri).not.toContain("memo=");
    expect((await h.checkouts.findById(session.id))?.collectedFields).toEqual(FIELDS);

    const expired = await prepareZcashPayment(
      { sessionId: session.id, fields: FIELDS },
      h.deps,
      new Date(LOCKED_AT.getTime() + 20 * 60_000),
    );
    expect(expired.quoteExpired).toBe(true);
  });

  it("refuses sessions on another network or without a quote", async () => {
    const { h } = setup();
    const evm = await openSession(h, "base");
    await expectCode(prepareZcashPayment({ sessionId: evm.id, fields: FIELDS }, h.deps), "session_not_payable");
    const unquoted = await openSession(h, "zcash");
    await expectCode(prepareZcashPayment({ sessionId: unquoted.id, fields: FIELDS }, h.deps), "session_not_payable");
  });
});

describe("Zcash status polling", () => {
  it("waits with one explorer call per payTo per minute", async () => {
    const { h, explorer, cache } = setup();
    const first = await zcashSession(h);
    const second = await zcashSession(h, { settlementQuote: lockedQuote("50001234", LOCKED_AT) });

    const t0 = new Date(LOCKED_AT.getTime() + 1_000);
    expect(await getZcashStatus(first.id, h.deps, { cache, now: t0 })).toEqual({ status: "waiting", quoteExpired: false });
    await getZcashStatus(second.id, h.deps, { cache, now: new Date(t0.getTime() + 20_000) });
    await getZcashStatus(first.id, h.deps, { cache, now: new Date(t0.getTime() + 40_000) });
    expect(explorer.calls).toEqual([`addr:${ZEC_PAY_TO}`]);

    await getZcashStatus(first.id, h.deps, { cache, now: new Date(t0.getTime() + 61_000) });
    expect(explorer.calls).toEqual([`addr:${ZEC_PAY_TO}`, `addr:${ZEC_PAY_TO}`]);
  });

  it("finds the payment by exact amount, claims it while confirming, then settles it", async () => {
    const { h, explorer, cache } = setup();
    const session = await zcashSession(h);
    explorer.activity = [
      { txid: "cd".repeat(32), blockHeight: null, blockTime: null, balanceChange: 50_001_234n }, // another session
      { txid: TXID, blockHeight: null, blockTime: null, balanceChange: BigInt(AMOUNT) },
    ];
    explorer.txs[TXID] = payTx({ blockHeight: null, blockTime: null, confirmations: 0 });

    const mempool = await getZcashStatus(session.id, h.deps, { cache, now: MINED });
    expect(mempool).toMatchObject({ status: "confirming", txHash: TXID, message: expect.stringMatching(/mempool/) });
    expect(mempool.status === "confirming" && mempool.explorerUrl).toBe(`https://blockchair.com/zcash/transaction/${TXID}`);
    const claimed = await h.payments.findByCheckoutSessionId(session.id);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ status: "pending", network: "zcash", txHash: TXID });

    explorer.txs[TXID] = payTx({ confirmations: 1 });
    const oneConf = await getZcashStatus(session.id, h.deps, { cache, now: MINED });
    expect(oneConf).toMatchObject({ status: "confirming", message: expect.stringMatching(/1 < 3/) });

    explorer.txs[TXID] = payTx({ confirmations: 3 });
    const paid = await getZcashStatus(session.id, h.deps, { cache, now: MINED });
    expect(paid).toMatchObject({ status: "paid", txHash: TXID });
    expect((await h.checkouts.findById(session.id))?.status).toBe("completed");
    const payments = await h.payments.findByCheckoutSessionId(session.id);
    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe("confirmed");

    // The claimed txid was re-verified directly; the address was scanned once.
    expect(explorer.calls.filter((call) => call.startsWith("addr:"))).toHaveLength(1);
    expect(await getZcashStatus(session.id, h.deps, { cache, now: MINED })).toMatchObject({ status: "paid" });
  });

  it("holds a payment made after the quote expired for review", async () => {
    const { h, explorer, cache } = setup();
    const session = await zcashSession(h);
    const late = new Date(LOCKED_AT.getTime() + 40 * 60_000);
    explorer.activity = [{ txid: TXID, blockHeight: 3_500_100, blockTime: late, balanceChange: BigInt(AMOUNT) }];
    explorer.txs[TXID] = payTx({ blockTime: late });

    const status = await getZcashStatus(session.id, h.deps, { cache, now: late });
    expect(status).toMatchObject({ status: "review", txHash: TXID, message: expect.stringMatching(/under review/) });
    expect((await h.checkouts.findById(session.id))?.status).toBe("open");
    expect((await h.payments.findByCheckoutSessionId(session.id))[0]).toMatchObject({ status: "pending", txHash: TXID });
  });

  it("keeps waiting (with a note) while the explorer is throttled", async () => {
    const { h, explorer, cache } = setup();
    const session = await zcashSession(h);
    explorer.down = true;
    expect(await getZcashStatus(session.id, h.deps, { cache, now: LOCKED_AT })).toMatchObject({
      status: "waiting",
      note: expect.stringMatching(/busy/),
    });
  });
});

describe("pasted Zcash txids", () => {
  it("settles a pasted txid paying the exact amount", async () => {
    const { h, explorer } = setup();
    const session = await zcashSession(h);
    explorer.txs[TXID] = payTx();
    const { payment } = await recordAndConfirm(session.id, TXID.toUpperCase(), h.deps);
    expect(payment).toMatchObject({ status: "confirmed", network: "zcash", txHash: TXID, confirmations: 5 });
  });

  it.each([
    ["an underpayment", { outputs: [{ recipient: ZEC_PAY_TO, value: BigInt(AMOUNT) - 1n }] }, /expected exactly/],
    ["an overpayment (tag mismatch)", { outputs: [{ recipient: ZEC_PAY_TO, value: BigInt(AMOUNT) + 1n }] }, /expected exactly/],
    ["another address", { outputs: [{ recipient: ZEC_PAYER, value: BigInt(AMOUNT) }] }, /no output/],
    ["a tx mined before the session", { blockTime: new Date(SESSION_CREATED.getTime() - 3_600_000) }, /before the checkout/],
  ])("rejects %s", async (_label, overrides, reason) => {
    const { h, explorer } = setup();
    const session = await zcashSession(h);
    explorer.txs[TXID] = payTx(overrides);
    const error = await expectCode(recordAndConfirm(session.id, TXID, h.deps), "verification_failed");
    expect(error.message).toMatch(reason);
    expect(await h.payments.findByCheckoutSessionId(session.id)).toHaveLength(0);
  });

  it("rejects EVM-shaped hashes on a Zcash session", async () => {
    const { h } = setup();
    const session = await zcashSession(h);
    await expectCode(recordAndConfirm(session.id, `0x${TXID}`, h.deps), "malformed_tx");
  });

  it("is pending (not claimed) for a txid the explorer does not know yet", async () => {
    const { h } = setup();
    const session = await zcashSession(h);
    await expectCode(recordAndConfirm(session.id, TXID, h.deps), "payment_pending");
    expect(await h.payments.findByCheckoutSessionId(session.id)).toHaveLength(0);
  });

  it("fails closed when Zcash is not enabled", async () => {
    const h = harness();
    const session = await zcashSession(h);
    const error = await expectCode(recordAndConfirm(session.id, TXID, h.deps), "verification_failed");
    expect(error.message).toMatch(/Zcash payments are not enabled/);
    await expectCode(getZcashStatus(session.id, h.deps), "network_not_configured");
  });
});
