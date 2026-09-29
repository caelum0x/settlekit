import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createHyperCoreSettlementVerifier,
  HYPERCORE_CLOCK_SKEW_MS,
  usdcTransferOf,
  usdToBaseUnits,
  verifyHyperCoreTransfer,
  type HyperCoreLedgerSource,
  type LedgerUpdate,
} from "../src/index.js";

/**
 * Ledgers recorded from https://api.hyperliquid.xyz/info
 * (`userNonFundingLedgerUpdates`) on 2026-09-29:
 *   - ledger-relay-fill: a Relay solver's `send` of 2700 USDC to its recipient
 *     (the fill of Relay request 0x1790691878…, see @settlekit/routing fixtures);
 *   - ledger-usdsend-incoming: a payee receiving `usdSend`s (internalTransfer)
 *     and making its own outgoing `send`s.
 */
function ledger(name: string): LedgerUpdate[] {
  const path = fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as LedgerUpdate[];
}

function source(updates: LedgerUpdate[]): HyperCoreLedgerSource & { calls: Array<{ user: string; startTime: number }> } {
  const calls: Array<{ user: string; startTime: number }> = [];
  return {
    calls,
    async ledgerUpdates(user, startTime) {
      calls.push({ user, startTime });
      return updates.filter((update) => update.time >= startTime);
    },
  };
}

const RELAY = ledger("ledger-relay-fill");
const RELAY_HASH = "0xd267e90cb92303e8d3e1044577e77b02049300f2542622ba7630945f7826ddd3";
const RELAY_PAYEE = "0xff96fcF6fe1e60a53A3C912683D12a03A32eF4b0";
const RELAY_SOLVER = "0xf70da97812cb96acdf810712aa562db8dfa3dbef";

const INCOMING = ledger("ledger-usdsend-incoming");
const PAYEE = "0xf70da97812cb96acdf810712aa562db8dfa3dbef";
const BUYER = "0x66cf0aace1b4e562593bec10ec7868fba9932224";
const USDSEND_HASH = "0x7bbd764405bdde787d3704457784c40205170029a0b0fd4a1f862196c4b1b863";
const USDSEND_TIME = 1790690062470;

describe("ledger parsing", () => {
  it("reads usdSend (internalTransfer) and Relay send credits", () => {
    expect(usdcTransferOf(INCOMING[4]!)).toEqual({
      hash: USDSEND_HASH,
      time: USDSEND_TIME,
      kind: "internalTransfer",
      from: BUYER,
      to: PAYEE,
      amount: "2887.73614",
    });
    expect(usdcTransferOf(RELAY[0]!)).toMatchObject({ kind: "send", amount: "2700.0", from: RELAY_SOLVER, nonce: 1790691879536 });
  });

  it("ignores non-USDC tokens, builder dexes and unrelated deltas", () => {
    const send = RELAY[0]!;
    expect(usdcTransferOf({ ...send, delta: { ...send.delta, token: "HYPE" } })).toBeNull();
    expect(usdcTransferOf({ ...send, delta: { ...send.delta, destinationDex: "xyz" } })).toBeNull();
    expect(usdcTransferOf({ ...send, delta: { ...send.delta, destinationDex: "spot" } })).not.toBeNull();
    expect(usdcTransferOf({ time: 1, hash: "0x", delta: { type: "deposit", usdc: "5" } })).toBeNull();
    expect(usdcTransferOf({ ...send, delta: { type: "spotTransfer", token: "USDC", amount: "3", user: BUYER, destination: PAYEE } })).toMatchObject({
      kind: "spotTransfer",
      amount: "3",
    });
  });

  it("converts USD decimals to 6-decimal base units, rounding down", () => {
    expect(usdToBaseUnits("2887.73614")).toBe(2_887_736_140n);
    expect(usdToBaseUnits("2700.0")).toBe(2_700_000_000n);
    expect(usdToBaseUnits("0.00000099")).toBe(0n);
    expect(usdToBaseUnits("1.2345679")).toBe(1_234_567n);
    expect(usdToBaseUnits("abc")).toBeNull();
    expect(usdToBaseUnits("-1")).toBeNull();
  });
});

describe("verifyHyperCoreTransfer by hash", () => {
  const notBefore = new Date(USDSEND_TIME - 60_000);

  it("confirms a usdSend to payTo for at least the expected amount", async () => {
    const src = source(INCOMING);
    const result = await verifyHyperCoreTransfer(src, { txHash: USDSEND_HASH.toUpperCase().replace("0X", "0x"), payTo: PAYEE, expectedBase: 2_887_736_140n, notBefore });
    expect(result).toEqual({
      ok: true,
      hash: USDSEND_HASH,
      from: BUYER,
      amountBase: 2_887_736_140n,
      time: new Date(USDSEND_TIME),
      kind: "internalTransfer",
      confirmations: 1,
    });
    expect(src.calls).toEqual([{ user: PAYEE, startTime: notBefore.getTime() - HYPERCORE_CLOCK_SKEW_MS }]);
  });

  it("confirms the Relay fill (send) to the route recipient", async () => {
    const result = await verifyHyperCoreTransfer(source(RELAY), {
      txHash: RELAY_HASH,
      payTo: RELAY_PAYEE,
      expectedBase: 2_700_000_000n,
      notBefore: new Date(1790691878677),
    });
    expect(result).toMatchObject({ ok: true, kind: "send", from: RELAY_SOLVER });
  });

  it("rejects underpayment", async () => {
    const result = await verifyHyperCoreTransfer(source(INCOMING), { txHash: USDSEND_HASH, payTo: PAYEE, expectedBase: 2_887_736_141n, notBefore });
    expect(result).toMatchObject({ ok: false, code: "underpaid", retryable: false });
  });

  it("rejects the payee's OUTGOING transfer (destination is someone else)", async () => {
    const outgoing = INCOMING[0]!.hash;
    const result = await verifyHyperCoreTransfer(source(INCOMING), { txHash: outgoing, payTo: PAYEE, expectedBase: 1n, notBefore: new Date(0) });
    expect(result).toMatchObject({ ok: false, code: "wrong_destination" });
  });

  it("rejects a transfer made before the session (outside the skew)", async () => {
    const all: HyperCoreLedgerSource = { ledgerUpdates: async () => INCOMING };
    const result = await verifyHyperCoreTransfer(all, {
      txHash: USDSEND_HASH,
      payTo: PAYEE,
      expectedBase: 1n,
      notBefore: new Date(USDSEND_TIME + HYPERCORE_CLOCK_SKEW_MS + 1),
    });
    expect(result).toMatchObject({ ok: false, code: "too_old" });
  });

  it("enforces the declared payer", async () => {
    const params = { txHash: USDSEND_HASH, payTo: PAYEE, expectedBase: 1n, notBefore };
    expect(await verifyHyperCoreTransfer(source(INCOMING), { ...params, payer: "0x1111111111111111111111111111111111111111" })).toMatchObject({
      ok: false,
      code: "payer_mismatch",
    });
    expect(await verifyHyperCoreTransfer(source(INCOMING), { ...params, payer: BUYER.toUpperCase().replace("0X", "0x") })).toMatchObject({ ok: true });
  });

  it("reports an unknown hash as not found (retryable) and never paid", async () => {
    const result = await verifyHyperCoreTransfer(source(INCOMING), { txHash: `0x${"ab".repeat(32)}`, payTo: PAYEE, expectedBase: 1n, notBefore });
    expect(result).toMatchObject({ ok: false, code: "not_found", retryable: true });
  });

  it("rejects malformed hashes without calling the API", async () => {
    const src = source(INCOMING);
    expect(await verifyHyperCoreTransfer(src, { txHash: "0x1234", payTo: PAYEE, expectedBase: 1n, notBefore })).toMatchObject({ code: "malformed" });
    expect(await verifyHyperCoreTransfer(src, { payTo: PAYEE, expectedBase: 1n, notBefore })).toMatchObject({ code: "malformed" });
    expect(src.calls).toHaveLength(0);
  });

  it("fails closed (retryable) when the API is down or returns garbage", async () => {
    const down: HyperCoreLedgerSource = { ledgerUpdates: async () => Promise.reject(new Error("ETIMEDOUT")) };
    expect(await verifyHyperCoreTransfer(down, { txHash: USDSEND_HASH, payTo: PAYEE, expectedBase: 1n, notBefore })).toMatchObject({
      ok: false,
      code: "api_unavailable",
      retryable: true,
    });
    const garbage = { ledgerUpdates: async () => ({ error: "x" }) as unknown as LedgerUpdate[] };
    expect(await verifyHyperCoreTransfer(garbage, { txHash: USDSEND_HASH, payTo: PAYEE, expectedBase: 1n, notBefore })).toMatchObject({
      code: "api_unavailable",
    });
  });
});

describe("verifyHyperCoreTransfer by submitted action", () => {
  const notBefore = new Date(USDSEND_TIME - 60_000);

  it("finds the usdSend by signer and nonce window", async () => {
    const result = await verifyHyperCoreTransfer(source(INCOMING), {
      submitted: { sender: BUYER, nonce: USDSEND_TIME - 900 },
      payTo: PAYEE,
      expectedBase: 2_000_000_000n,
      notBefore,
    });
    expect(result).toMatchObject({ ok: true, hash: USDSEND_HASH });
  });

  it("matches `send` entries by exact nonce", async () => {
    const result = await verifyHyperCoreTransfer(source(RELAY), {
      submitted: { sender: RELAY_SOLVER, nonce: 1790691879536 },
      payTo: RELAY_PAYEE,
      expectedBase: 1n,
      notBefore: new Date(1790691870000),
    });
    expect(result).toMatchObject({ ok: true, hash: RELAY_HASH });
    const wrongNonce = await verifyHyperCoreTransfer(source(RELAY), {
      submitted: { sender: RELAY_SOLVER, nonce: 1790691879537 },
      payTo: RELAY_PAYEE,
      expectedBase: 1n,
      notBefore: new Date(1790691870000),
    });
    expect(wrongNonce).toMatchObject({ ok: false, code: "not_found", retryable: true });
  });

  it("does not attribute another sender's transfer to the buyer", async () => {
    const result = await verifyHyperCoreTransfer(source(INCOMING), {
      submitted: { sender: "0x2222222222222222222222222222222222222222", nonce: USDSEND_TIME },
      payTo: PAYEE,
      expectedBase: 1n,
      notBefore,
    });
    expect(result).toMatchObject({ ok: false, code: "not_found" });
  });

  // The buyer's LAST usdSend in the fixture (nothing from it lands later).
  const LAST_USDSEND_TIME = 1790690222639;

  it("never claims a transfer made before the session on the submission path (no skew)", async () => {
    // 1s before the session: the hash path tolerates clock skew, the
    // submission-window fallback must not (it could claim an earlier payment).
    const result = await verifyHyperCoreTransfer(source(INCOMING), {
      submitted: { sender: BUYER, nonce: LAST_USDSEND_TIME },
      payTo: PAYEE,
      expectedBase: 1n,
      notBefore: new Date(LAST_USDSEND_TIME + 1_000),
    });
    expect(result).toMatchObject({ ok: false, code: "not_found" });
  });

  it("only matches a transfer landing shortly after the signed nonce", async () => {
    const notBefore = new Date(LAST_USDSEND_TIME - 6 * 60_000);
    const late = await verifyHyperCoreTransfer(source(INCOMING), {
      submitted: { sender: BUYER, nonce: LAST_USDSEND_TIME - 5 * 60_000 },
      payTo: PAYEE,
      expectedBase: 1n,
      notBefore,
    });
    expect(late).toMatchObject({ ok: false, code: "not_found" });
    const beforeNonce = await verifyHyperCoreTransfer(source(INCOMING), {
      submitted: { sender: BUYER, nonce: LAST_USDSEND_TIME + 60_000 },
      payTo: PAYEE,
      expectedBase: 1n,
      notBefore,
    });
    expect(beforeNonce).toMatchObject({ ok: false, code: "not_found" });
  });

  it("reports underpayment of the matched transfer", async () => {
    const result = await verifyHyperCoreTransfer(source(INCOMING), {
      submitted: { sender: BUYER, nonce: USDSEND_TIME },
      payTo: PAYEE,
      expectedBase: 999_999_000_000n,
      notBefore,
    });
    expect(result).toMatchObject({ ok: false, code: "underpaid" });
  });
});

describe("createHyperCoreSettlementVerifier", () => {
  const verifier = createHyperCoreSettlementVerifier(source(INCOMING));
  const proof = { txHash: USDSEND_HASH, from: "", amount: "", network: "hypercore" as const, nonce: "" };
  const requirements = {
    scheme: "exact",
    amount: "2887.73614",
    asset: "USDC",
    network: "hypercore" as const,
    payTo: PAYEE,
    productId: "",
    resource: "checkout_session:cs_1",
    nonce: "",
    notBefore: new Date(USDSEND_TIME - 60_000).toISOString(),
  };

  it("confirms with one confirmation", async () => {
    expect(await verifier(proof, requirements)).toEqual({ ok: true, confirmations: 1 });
  });

  it("rejects other networks, assets and amounts", async () => {
    expect(await verifier({ ...proof, network: "base" }, requirements)).toMatchObject({ ok: false });
    expect(await verifier(proof, { ...requirements, asset: "EURC" })).toMatchObject({ ok: false, reason: expect.stringMatching(/asset/) });
    expect(await verifier(proof, { ...requirements, amount: "1.1234567" })).toMatchObject({ ok: false, reason: expect.stringMatching(/Invalid amount/) });
    expect(await verifier(proof, { ...requirements, amount: "2887.736141" })).toMatchObject({ ok: false, retryable: false });
    expect(await verifier(proof, { ...requirements, payer: "0x1111111111111111111111111111111111111111" })).toMatchObject({ ok: false });
  });
});
