/**
 * HyperCore checkout: the buyer's wallet signs a usdSend, the server binds
 * the signer, submits through the SDK transport (faked here) and settles
 * once the transfer is in the payee's ledger. Pasted hashes verify through
 * the same ledger rules; everything fails closed.
 */
import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { HyperliquidTransport, LedgerUpdate } from "@settlekit/hyperliquid";

import { CheckoutError } from "../lib/errors";
import { loadHyperCoreRuntime } from "../lib/hypercore";
import {
  getHyperCorePaymentParams,
  settleHyperCoreSubmission,
  submitHyperCorePayment,
} from "../lib/hypercore-checkout";
import { getDeliveredAccess, recordAndConfirm } from "../lib/store";
import { FIELDS, MERCHANT_EVM, SESSION_CREATED, harness, openSession } from "./harness";

// Well-known Anvil/Hardhat test account #1 (never holds real funds).
const buyer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const NOW = new Date(SESSION_CREATED.getTime() + 60_000);
const HASH = `0x${"7b".repeat(32)}`;

interface FakeHl {
  ledger: LedgerUpdate[];
  exchange: unknown[];
  reply: unknown;
  transport: HyperliquidTransport;
}

function fakeHyperliquid(): FakeHl {
  const state: FakeHl = { ledger: [], exchange: [], reply: { status: "ok", response: { type: "default" } }, transport: undefined as never };
  state.transport = {
    isTestnet: false,
    async request<T>(endpoint: "info" | "exchange", payload: unknown): Promise<T> {
      if (endpoint === "exchange") {
        state.exchange.push(payload);
        return state.reply as T;
      }
      const { user, startTime } = payload as { user: string; startTime: number };
      return state.ledger.filter((entry) => entry.time >= startTime && JSON.stringify(entry.delta).includes(user)) as T;
    },
  };
  return state;
}

function setup(env: Record<string, string> = { HYPERCORE_ENABLED: "true", HYPERCORE_NETWORK: "mainnet" }) {
  const hl = fakeHyperliquid();
  const h = harness({ hypercore: loadHyperCoreRuntime(env, hl.transport) });
  return { hl, h };
}

function credit(hash: string, from: string, to: string, usdc: string, time: number): LedgerUpdate {
  return { time, hash, delta: { type: "internalTransfer", usdc, user: from.toLowerCase(), destination: to.toLowerCase(), fee: "0.0" } };
}

async function signedAction(sessionId: string, h: ReturnType<typeof setup>["h"], overrides: Record<string, unknown> = {}) {
  const params = await getHyperCorePaymentParams(sessionId, h.deps);
  const action = {
    type: "usdSend",
    signatureChainId: "0xa4b1",
    hyperliquidChain: params.hyperliquidChain,
    destination: params.destination,
    amount: params.amount,
    time: NOW.getTime(),
    ...overrides,
  };
  const signature = await buyer.signTypedData({
    domain: { ...params.domain, chainId: 42161 },
    types: params.types,
    primaryType: params.primaryType,
    message: {
      hyperliquidChain: action.hyperliquidChain as string,
      destination: action.destination as `0x${string}`,
      amount: action.amount as string,
      time: BigInt(action.time as number),
    },
  });
  return { action, signature };
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

describe("HyperCore wallet flow", () => {
  it("returns the usdSend signing parameters for the session", async () => {
    const { h } = setup();
    const session = await openSession(h, "hypercore");
    expect(await getHyperCorePaymentParams(session.id, h.deps)).toMatchObject({
      network: "hypercore",
      env: "mainnet",
      hyperliquidChain: "Mainnet",
      destination: MERCHANT_EVM.toLowerCase(),
      amount: "25",
      amountBase: "25000000",
      primaryType: "HyperliquidTransaction:UsdSend",
      explorerTxBase: "https://app.hyperliquid.xyz/explorer/tx/",
    });
  });

  it("submits the signed transfer, binds the signer and settles once it is in the ledger", async () => {
    const { hl, h } = setup();
    const session = await openSession(h, "hypercore");
    const { action, signature } = await signedAction(session.id, h);

    const first = await submitHyperCorePayment({ sessionId: session.id, action, signature, fields: FIELDS }, h.deps, NOW);
    expect(first).toEqual({ status: "waiting", nonce: NOW.getTime(), message: expect.any(String) });
    expect(hl.exchange).toEqual([{ action, signature: expect.objectContaining({ v: expect.any(Number) }), nonce: NOW.getTime() }]);
    expect((await h.checkouts.findById(session.id))?.payerAddress).toBe(buyer.address);

    hl.ledger.push(credit(HASH, buyer.address, MERCHANT_EVM, "25.0", NOW.getTime() + 800));
    const paid = await settleHyperCoreSubmission(session.id, NOW.getTime(), h.deps);
    expect(paid).toEqual({ status: "paid", txHash: HASH, explorerUrl: `https://app.hyperliquid.xyz/explorer/tx/${HASH}` });
    expect((await h.checkouts.findById(session.id))?.status).toBe("completed");
    expect((await h.payments.findByTxHash(HASH))?.network).toBe("hypercore");
    expect(await getDeliveredAccess(session.id, h.deps)).toHaveLength(1);
    // Polling again stays paid.
    expect((await settleHyperCoreSubmission(session.id, NOW.getTime(), h.deps)).status).toBe("paid");
  });

  it("refuses actions not bound to the session", async () => {
    const { h } = setup();
    const session = await openSession(h, "hypercore");
    const input = async (overrides: Record<string, unknown>) => ({ sessionId: session.id, ...(await signedAction(session.id, h, overrides)), fields: FIELDS });
    await expectCode(submitHyperCorePayment(await input({ destination: "0x4444444444444444444444444444444444444444" }), h.deps, NOW), "verification_failed");
    await expectCode(submitHyperCorePayment(await input({ amount: "2.5" }), h.deps, NOW), "verification_failed");
    await expectCode(submitHyperCorePayment(await input({ hyperliquidChain: "Testnet" }), h.deps, NOW), "verification_failed");
    await expectCode(submitHyperCorePayment(await input({ time: NOW.getTime() - 10 * 60_000 }), h.deps, NOW), "invalid_request");
    await expectCode(submitHyperCorePayment(await input({ type: "spotSend" }), h.deps, NOW), "invalid_request");
    const good = await signedAction(session.id, h);
    await expectCode(submitHyperCorePayment({ sessionId: session.id, ...good, signature: "0x1234", fields: FIELDS }, h.deps, NOW), "invalid_request");
    await expectCode(submitHyperCorePayment({ sessionId: session.id, ...good, fields: {} }, h.deps, NOW), "fields_incomplete");
  });

  it("refuses a signer other than the bound payer", async () => {
    const { h } = setup();
    const session = await openSession(h, "hypercore", { payerAddress: "0x2222222222222222222222222222222222222222" });
    const signed = await signedAction(session.id, h);
    const error = await expectCode(submitHyperCorePayment({ sessionId: session.id, ...signed, fields: FIELDS }, h.deps, NOW), "verification_failed");
    expect(error.message).toMatch(/another wallet/);
  });

  it("maps a Hyperliquid rejection to verification_failed and never pays", async () => {
    const { hl, h } = setup();
    hl.reply = { status: "err", response: "Insufficient balance for token transfer" };
    const session = await openSession(h, "hypercore");
    const signed = await signedAction(session.id, h);
    const error = await expectCode(submitHyperCorePayment({ sessionId: session.id, ...signed, fields: FIELDS }, h.deps, NOW), "verification_failed");
    expect(error.message).toMatch(/Insufficient balance/);
    expect(await h.payments.findByCheckoutSessionId(session.id)).toEqual([]);
  });

  it("reports an underpaid ledger credit as failed", async () => {
    const { hl, h } = setup();
    const session = await openSession(h, "hypercore");
    const signed = await signedAction(session.id, h);
    hl.ledger.push(credit(HASH, buyer.address, MERCHANT_EVM, "24.99", NOW.getTime() + 500));
    const result = await submitHyperCorePayment({ sessionId: session.id, ...signed, fields: FIELDS }, h.deps, NOW);
    expect(result).toMatchObject({ status: "failed", reason: expect.stringMatching(/expected at least/) });
  });
});

describe("HyperCore pasted hash", () => {
  it("confirms a usdSend to payTo and rejects replays on another session (409)", async () => {
    const { hl, h } = setup();
    const session = await openSession(h, "hypercore");
    hl.ledger.push(credit(HASH, buyer.address, MERCHANT_EVM, "25", NOW.getTime()));
    const { payment } = await recordAndConfirm(session.id, HASH.toUpperCase().replace("0X", "0x"), h.deps);
    expect(payment).toMatchObject({ status: "confirmed", network: "hypercore", txHash: HASH, confirmations: 1 });

    const other = await openSession(h, "hypercore");
    const error = await expectCode(recordAndConfirm(other.id, HASH, h.deps), "duplicate_tx");
    expect(error.status).toBe(409);
  });

  it("fails closed: transfers before the session, to others, unknown hashes, disabled HyperCore", async () => {
    const { hl, h } = setup();
    const session = await openSession(h, "hypercore");
    hl.ledger.push(credit(`0x${"01".repeat(32)}`, buyer.address, MERCHANT_EVM, "25", SESSION_CREATED.getTime() - 3_600_000));
    hl.ledger.push(credit(`0x${"02".repeat(32)}`, MERCHANT_EVM, buyer.address, "25", NOW.getTime()));
    await expectCode(recordAndConfirm(session.id, `0x${"01".repeat(32)}`, h.deps), "payment_pending");
    await expectCode(recordAndConfirm(session.id, `0x${"02".repeat(32)}`, h.deps), "verification_failed");
    await expectCode(recordAndConfirm(session.id, `0x${"03".repeat(32)}`, h.deps), "payment_pending");

    const off = harness();
    const offSession = await openSession(off, "hypercore");
    const error = await expectCode(recordAndConfirm(offSession.id, HASH, off.deps), "verification_failed");
    expect(error.message).toMatch(/HyperCore payments are not enabled/);
  });

  it("is unavailable (fail closed) when HYPERCORE_ENABLED is unset", async () => {
    const { h } = setup({});
    const session = await openSession(h, "hypercore");
    await expectCode(getHyperCorePaymentParams(session.id, h.deps), "network_not_configured");
  });
});
