import { describe, expect, it } from "vitest";
import { isErr, isOk, money, compareMoney } from "@settlekit/common";
import { withSettleKitPayment } from "@settlekit/x402";
import { createLocalSettlement } from "../src/local-ledger.js";
import { payAndFetch } from "../src/payer.js";

const PAY_TO = "0x000000000000000000000000000000000000beef";
const RESOURCE = "https://toll.test/articles/lepton";

function protectedHandler(
  verify: Parameters<typeof withSettleKitPayment>[0]["verify"],
  price = "0.002",
) {
  return withSettleKitPayment({
    price,
    currency: "USDC",
    network: "arc",
    payTo: PAY_TO,
    productId: "prod_demo",
    verify,
  })(() => Response.json({ secret: "the lepton is reborn" }));
}

describe("x402 closed loop (local settlement)", () => {
  it("pays the toll and receives the gated content", async () => {
    const { ledger, settler, verify } = createLocalSettlement();
    const handler = protectedHandler(verify);

    const result = await payAndFetch(RESOURCE, { fetcher: handler, settler, from: "0xagent" });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.paid).toBe(true);
    expect(result.value.response.status).toBe(200);
    await expect(result.value.response.json()).resolves.toEqual({
      secret: "the lepton is reborn",
    });

    expect(ledger.count()).toBe(1);
    expect(compareMoney(ledger.totalVolume(), money("0.002"))).toBe(0);
    expect(compareMoney(ledger.receivedBy(PAY_TO), money("0.002"))).toBe(0);
  });

  it("enforces a per-call spend cap before paying", async () => {
    const { ledger, settler, verify } = createLocalSettlement();
    const handler = protectedHandler(verify, "0.05");

    const result = await payAndFetch(RESOURCE, {
      fetcher: handler,
      settler,
      from: "0xagent",
      maxPriceUsdc: "0.01",
    });

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.code).toBe("payment_required");
    expect(ledger.count()).toBe(0);
  });

  it("returns free (non-402) resources without paying", async () => {
    const { settler } = createLocalSettlement();
    const free = () => Promise.resolve(Response.json({ open: true }));

    const result = await payAndFetch(RESOURCE, { fetcher: free, settler, from: "0xagent" });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.paid).toBe(false);
  });

  it("rejects a proof the resource's verifier does not recognize", async () => {
    const payer = createLocalSettlement();
    const resource = createLocalSettlement();
    const handler = protectedHandler(resource.verify);

    const result = await payAndFetch(RESOURCE, {
      fetcher: handler,
      settler: payer.settler,
      from: "0xagent",
    });

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.code).toBe("payment_failed");
  });
});
