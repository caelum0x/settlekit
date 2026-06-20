import { describe, expect, it } from "vitest";
import { InMemoryIdempotencyStore } from "@settlekit/settlement-core";
import type { SettlementRequest } from "@settlekit/settlement-core";
import {
  ArcSettlementProvider,
  LocalAppKitSdk,
  configureAppKit,
} from "../src/index.js";

const ADAPTER = "viem:0xtreasury";

function provider(opts: { sdk?: LocalAppKitSdk; idempotency?: InMemoryIdempotencyStore } = {}) {
  const sdk = opts.sdk ?? new LocalAppKitSdk();
  const client = configureAppKit<string>({ sdk, env: {} });
  const p = new ArcSettlementProvider<string>({
    client,
    adapter: ADAPTER,
    ...(opts.idempotency !== undefined ? { idempotency: opts.idempotency } : {}),
  });
  return { p, sdk };
}

const request: SettlementRequest = {
  reference: "citation:src_1:nonce_1",
  to: "0xauthor",
  amountUsdc: "0.05",
  network: "arc",
};

describe("ArcSettlementProvider", () => {
  it("settles a request on Arc and returns a settled receipt", async () => {
    const { p, sdk } = provider();
    const receipt = await p.settle(request);
    expect(receipt.status).toBe("settled");
    expect(receipt.provider).toBe("circle");
    expect(receipt.txHash).toMatch(/^0xlocal/);
    expect(receipt.settledAt).toBeDefined();
    expect(sdk.calls()).toEqual([{ kind: "send", amount: "0.05", chain: "Arc_Testnet" }]);
  });

  it("maps networks to mainnet chains when configured", async () => {
    const sdk = new LocalAppKitSdk();
    const client = configureAppKit<string>({ sdk, env: {} });
    const p = new ArcSettlementProvider<string>({ client, adapter: ADAPTER, chains: "mainnet" });
    await p.settle({ ...request, network: "base" });
    expect(sdk.calls()[0]?.chain).toBe("Base");
  });

  it("is idempotent: a repeated reference does not re-settle", async () => {
    const idempotency = new InMemoryIdempotencyStore();
    const { p, sdk } = provider({ idempotency });
    const first = await p.settle(request);
    const second = await p.settle(request);
    expect(second.id).toBe(first.id);
    expect(sdk.calls().length).toBe(1);
  });

  it("records a terminal failure as a failed receipt (no retry)", async () => {
    const { p } = provider({ sdk: new LocalAppKitSdk({ state: "reverted" }) });
    const receipt = await p.settle(request);
    expect(receipt.status).toBe("failed");
    expect(receipt.failureReason).toBeDefined();
  });

  it("rethrows a retryable failure so the claim is released for retry", async () => {
    const idempotency = new InMemoryIdempotencyStore();
    const { p } = provider({ sdk: new LocalAppKitSdk({ throwOn: ["send"] }), idempotency });
    await expect(p.settle(request)).rejects.toThrow(/send failed/);
    // The pending claim was released, so a fresh attempt can proceed.
    const retry = provider({ idempotency });
    const receipt = await retry.p.settle(request);
    expect(receipt.status).toBe("settled");
  });
});
