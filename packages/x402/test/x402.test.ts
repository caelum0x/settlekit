import { describe, expect, it } from "vitest";
import { withSettleKitPayment } from "../src/index.js";

describe("withSettleKitPayment", () => {
  it("returns HTTP 402 until a payment proof header is present", async () => {
    const handler = withSettleKitPayment({ price: "0.005", currency: "USDC", productId: "prod_1" })(() => Response.json({ ok: true }));
    expect((await handler(new Request("https://example.com"))).status).toBe(402);
    expect((await handler(new Request("https://example.com", { headers: { "x-settlekit-payment": "proof" } }))).status).toBe(200);
  });
});
