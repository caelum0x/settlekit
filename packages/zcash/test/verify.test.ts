import { describe, expect, it } from "vitest";
import {
  createBlockchairExplorer,
  findZcashPayment,
  verifyZcashTransparent,
  type ZcashExplorer,
  type ZcashTransaction,
} from "../src/index.js";
import { fixture, routedFetch } from "./fakes.js";

// Recorded Blockchair responses (tip 3500291; tx mined at block 3500129).
const TXID = "4c5b63098595b25090abb69e6fbb5431cd58735857f96bc33c6324d503791357";
const PAY_TO = "t1Ne88F8ouCV92brDXNBB47a85brvnEHE8g";
const OTHER = "t1gH8kwDu1euQky74m2CS15vtopntebdKX5";
const PAID = 375_527_095_632n;
const API = "https://api.blockchair.com/zcash";
const MINED_AT = new Date("2026-09-29T09:00:07Z");

function recordedExplorer(txBody: unknown = fixture("blockchair-tx.json")) {
  const fetch = routedFetch({
    [`${API}/dashboards/transaction/${TXID}`]: { body: txBody },
    [`${API}/dashboards/transaction/`]: { body: fixture("blockchair-tx-not-found.json") },
    [`${API}/dashboards/address/${PAY_TO}`]: { body: fixture("blockchair-address.json") },
  });
  return { explorer: createBlockchairExplorer({ fetch }), fetch };
}

const base = {
  txid: TXID,
  payTo: PAY_TO,
  expectedZats: PAID,
  minConfirmations: 3,
  notBefore: new Date("2026-09-29T08:50:00Z"),
  quoteExpiresAt: new Date("2026-09-29T09:05:00Z"),
};

describe("Blockchair explorer (recorded fixtures)", () => {
  it("decodes outputs, inputs, block time and confirmations", async () => {
    const { explorer } = recordedExplorer();
    const result = await explorer.getTransaction(TXID);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value === null) throw new Error("expected tx");
    expect(result.value.blockHeight).toBe(3_500_129);
    expect(result.value.confirmations).toBe(163);
    expect(result.value.blockTime).toEqual(MINED_AT);
    expect(result.value.outputs[0]).toEqual({ recipient: PAY_TO, value: PAID });
    expect(result.value.inputAddresses).toEqual([OTHER, OTHER]);
  });

  it("returns null for an unknown txid and passes the API key", async () => {
    const fetch = routedFetch({ [`${API}/dashboards/transaction/`]: { body: fixture("blockchair-tx-not-found.json") } });
    const explorer = createBlockchairExplorer({ fetch, apiKey: "k1" });
    expect(await explorer.getTransaction("ab".repeat(32))).toEqual({ ok: true, value: null });
    expect(fetch.calls[0]).toContain("key=k1");
  });

  it.each([402, 429, 435])("maps HTTP %i to retry-later, never success", async (status) => {
    const explorer = createBlockchairExplorer({ fetch: routedFetch({ [API]: { status } }) });
    const result = await explorer.getTransaction(TXID);
    expect(result).toMatchObject({ ok: false, retryLater: true, status });
    const verdict = await verifyZcashTransparent(explorer, base);
    expect(verdict).toMatchObject({ status: "pending", retryLater: true });
  });

  it("reads address activity with balance changes", async () => {
    const { explorer, fetch } = recordedExplorer();
    const result = await explorer.getAddressActivity(PAY_TO, 5);
    expect(result.ok && result.value.length).toBe(5);
    expect(result.ok && result.value[1]?.balanceChange).toBe(77_198_500_051n);
    expect(fetch.calls[0]).toContain("transaction_details=true");
  });
});

describe("verifyZcashTransparent", () => {
  it("confirms an exact, mined, sufficiently confirmed payment", async () => {
    const { explorer } = recordedExplorer();
    expect(await verifyZcashTransparent(explorer, base)).toEqual({
      status: "confirmed",
      confirmations: 163,
      receivedZats: PAID,
    });
  });

  it("rejects underpayment and (by default) any non-exact amount", async () => {
    const { explorer } = recordedExplorer();
    const under = await verifyZcashTransparent(explorer, { ...base, expectedZats: PAID + 1n });
    expect(under).toMatchObject({ status: "rejected" });
    const over = await verifyZcashTransparent(explorer, { ...base, expectedZats: PAID - 1n });
    expect(over).toMatchObject({ status: "rejected", reason: expect.stringMatching(/exactly/) });
    const atLeast = await verifyZcashTransparent(explorer, { ...base, expectedZats: PAID - 1n, exact: false });
    expect(atLeast.status).toBe("confirmed");
  });

  it("rejects a transaction that does not pay the session address", async () => {
    const { explorer } = recordedExplorer();
    const wrong = await verifyZcashTransparent(explorer, { ...base, payTo: "t1Ne88F8ouCV92brDXNBB47a85brvnEHE8h" });
    expect(wrong).toMatchObject({ status: "rejected", reason: expect.stringMatching(/no output/) });
  });

  it("stays pending while unconfirmed or in the mempool", async () => {
    const { explorer } = recordedExplorer();
    expect(await verifyZcashTransparent(explorer, { ...base, minConfirmations: 500 })).toMatchObject({
      status: "pending",
      confirmations: 163,
    });
    const recorded = fixture<{ data: Record<string, { transaction: { block_id: number } }> }>("blockchair-tx.json");
    const mempool = structuredClone(recorded);
    (mempool.data[TXID] as { transaction: { block_id: number } }).transaction.block_id = -1;
    expect(await verifyZcashTransparent(recordedExplorer(mempool).explorer, base)).toMatchObject({
      status: "pending",
      reason: expect.stringMatching(/mempool/),
    });
    expect(await verifyZcashTransparent(explorer, { ...base, txid: "ab".repeat(32) })).toMatchObject({ status: "pending" });
  });

  it("rejects payments mined before the session and flags late ones for review", async () => {
    const { explorer } = recordedExplorer();
    const early = await verifyZcashTransparent(explorer, { ...base, notBefore: new Date("2026-09-29T10:00:00Z") });
    expect(early).toMatchObject({ status: "rejected", reason: expect.stringMatching(/before/) });
    const late = await verifyZcashTransparent(explorer, { ...base, quoteExpiresAt: new Date("2026-09-29T08:45:00Z") });
    expect(late).toMatchObject({ status: "late", receivedZats: PAID });
    const withinGrace = await verifyZcashTransparent(explorer, { ...base, quoteExpiresAt: new Date("2026-09-29T08:55:00Z") });
    expect(withinGrace.status).toBe("confirmed");
  });

  it("enforces payer binding and txid shape", async () => {
    const { explorer } = recordedExplorer();
    expect(await verifyZcashTransparent(explorer, { ...base, payer: OTHER })).toMatchObject({ status: "confirmed" });
    expect(await verifyZcashTransparent(explorer, { ...base, payer: PAY_TO })).toMatchObject({ status: "rejected" });
    expect(await verifyZcashTransparent(explorer, { ...base, txid: "0x1234" })).toMatchObject({ status: "rejected" });
  });
});

describe("findZcashPayment", () => {
  it("finds the exact-amount entry with one address call", async () => {
    const { explorer, fetch } = recordedExplorer();
    const found = await findZcashPayment(explorer, PAY_TO, {
      expectedZats: 77_198_500_051n,
      notBefore: new Date("2026-09-29T11:00:00Z"),
    });
    expect(found.ok && found.value?.txid).toBe("87ffd72ecb2753bcb31939dcd5ba7138c35e7a50a013fee1b8d4322c3fe96543");
    expect(fetch.calls).toHaveLength(1);
  });

  it("ignores matches before notBefore and non-matching amounts", async () => {
    const { explorer } = recordedExplorer();
    const early = await findZcashPayment(explorer, PAY_TO, {
      expectedZats: 77_198_500_051n,
      notBefore: new Date("2026-09-29T12:00:00Z"),
    });
    expect(early).toEqual({ ok: true, value: null });
    const none = await findZcashPayment(explorer, PAY_TO, { expectedZats: 1n, notBefore: new Date(0) });
    expect(none).toEqual({ ok: true, value: null });
  });

  it("propagates retry-later explorer errors", async () => {
    const explorer: ZcashExplorer = {
      getTransaction: async () => ({ ok: true, value: null as ZcashTransaction | null }),
      getAddressActivity: async () => ({ ok: false, retryLater: true, status: 429, reason: "rate limited" }),
    };
    expect(await findZcashPayment(explorer, PAY_TO, { expectedZats: 1n, notBefore: new Date(0) })).toMatchObject({
      ok: false,
      retryLater: true,
    });
  });
});
