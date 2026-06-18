import { describe, expect, it, vi } from "vitest";
import { compareMoney, money } from "@settlekit/common";
import type { CircleTransactionResource, WalletsClient } from "@settlekit/circle-wallets";
import type { GatewayClient } from "@settlekit/gateway";
import { LocalSettlementProvider } from "../src/local-provider.js";
import { CircleSettlementProvider } from "../src/circle-provider.js";
import {
  GatewaySettlementProvider,
  createGatewayTransferPort,
} from "../src/gateway-provider.js";
import { BatchAccumulator } from "../src/batch.js";
import { reconcileReceipts } from "../src/reconcile.js";
import { InMemoryNonceStore } from "../src/idempotency.js";
import type { SettlementReceipt, SettlementRequest } from "../src/types.js";

const req = (over: Partial<SettlementRequest> = {}): SettlementRequest => ({
  reference: "ref-1",
  to: "0xrecipient",
  amountUsdc: "0.0008",
  network: "arc",
  ...over,
});

describe("LocalSettlementProvider", () => {
  it("settles and is idempotent on reference", async () => {
    const p = new LocalSettlementProvider();
    const first = await p.settle(req());
    const second = await p.settle(req());
    expect(first.status).toBe("settled");
    expect(second.id).toBe(first.id); // no second settlement
    expect(p.all()).toHaveLength(1);
    expect(compareMoney(p.totalVolume(), money("0.0008"))).toBe(0);
  });
});

describe("CircleSettlementProvider", () => {
  it("transfers via Circle, returns the tx hash, and dedupes by reference", async () => {
    const createTransfer = vi.fn(async () => ({ id: "txn_1" }) as CircleTransactionResource);
    const getTransaction = vi.fn(
      async () => ({ txHash: "0xcircle", state: "COMPLETE" }) as unknown as CircleTransactionResource,
    );
    const wallets = { createTransfer, getTransaction } as unknown as WalletsClient;

    const p = new CircleSettlementProvider({ wallets, walletId: "w1", tokenId: "usdc" });
    const r1 = await p.settle(req());
    const r2 = await p.settle(req());

    expect(r1.provider).toBe("circle");
    expect(r1.txHash).toBe("0xcircle");
    expect(r2.id).toBe(r1.id);
    expect(createTransfer).toHaveBeenCalledTimes(1); // idempotent
    // Reference is passed as Circle's idempotency key.
    expect(createTransfer.mock.calls[0]?.[0]).toMatchObject({ idempotencyKey: "ref-1" });
  });
});

describe("GatewaySettlementProvider", () => {
  it("orchestrates burn-intent -> sign -> attest -> mint", async () => {
    const client = {
      buildBurnIntent: vi.fn(() => ({ intent: true })),
      burnIntentTypedData: vi.fn(() => ({ domain: {}, types: {}, primaryType: "x", message: {} })),
      requestTransferAttestation: vi.fn(async () => ({ attestation: "0xatt", signature: "0xsig" })),
      buildGatewayMint: vi.fn(() => ({ to: "0xminter", data: "0x", value: 0n })),
    } as unknown as GatewayClient;

    const signTypedData = vi.fn(async () => "0xsigned" as `0x${string}`);
    const sendTransaction = vi.fn(async () => "0xmint");

    const port = createGatewayTransferPort({
      client,
      gatewayMinter: "0xminter",
      signTypedData,
      sendTransaction,
      toBurnIntentParams: () => ({}) as Parameters<GatewayClient["buildBurnIntent"]>[0],
    });

    const p = new GatewaySettlementProvider(port);
    const receipt = await p.settle(req({ amountUsdc: "0.5" }));

    expect(receipt.provider).toBe("gateway");
    expect(receipt.txHash).toBe("0xmint");
    expect(signTypedData).toHaveBeenCalledOnce();
    expect(sendTransaction).toHaveBeenCalledOnce();
    expect(compareMoney(receipt.amount, money("0.5"))).toBe(0);
  });
});

describe("BatchAccumulator", () => {
  it("groups settlements by recipient and settles one transfer per group", async () => {
    const provider = new LocalSettlementProvider();
    const batch = new BatchAccumulator(provider);
    batch.add(req({ reference: "a", to: "0xauthor1", amountUsdc: "0.0001" }));
    batch.add(req({ reference: "b", to: "0xauthor1", amountUsdc: "0.0002" }));
    batch.add(req({ reference: "c", to: "0xauthor2", amountUsdc: "0.0005" }));

    expect(batch.size()).toBe(2);
    expect(compareMoney(batch.pendingTotal(), money("0.0008"))).toBe(0);

    const receipts = await batch.flush();
    expect(receipts).toHaveLength(2);
    expect(batch.size()).toBe(0);
    const author1 = receipts.find((r) => r.to === "0xauthor1");
    expect(author1 && compareMoney(author1.amount, money("0.0003"))).toBe(0);
  });
});

describe("reconcileReceipts", () => {
  const base: SettlementReceipt = {
    id: "stl_1",
    reference: "r1",
    to: "0xto",
    amount: money("0.001"),
    network: "arc",
    status: "submitted",
    provider: "gateway",
    txHash: "0xhash",
    createdAt: "2026-06-18T00:00:00.000Z",
  };

  it("advances confirmed receipts to settled and leaves others", async () => {
    const source = {
      confirmations: async (tx: string) => (tx === "0xhash" ? 3 : null),
    };
    const results = await reconcileReceipts(
      [base, { ...base, id: "stl_2", txHash: "0xunknown" }],
      source,
    );
    expect(results[0]?.changed).toBe(true);
    expect(results[0]?.receipt.status).toBe("settled");
    expect(results[0]?.receipt.settledAt).toBeDefined();
    expect(results[1]?.changed).toBe(false); // not yet indexed
  });

  it("does not settle below the confirmation threshold", async () => {
    const source = { confirmations: async () => 1 };
    const [result] = await reconcileReceipts([base], source, { minConfirmations: 3 });
    expect(result?.changed).toBe(false);
  });
});

describe("InMemoryNonceStore", () => {
  it("consumes a nonce exactly once", async () => {
    const store = new InMemoryNonceStore();
    const nonce = await store.issue();
    expect(await store.consume(nonce)).toBe(true);
    expect(await store.consume(nonce)).toBe(false);
  });
});
