import { describe, expect, it } from "vitest";
import { createRfqClient } from "../src/rfq.js";
import type { MintHttp, MintRequest } from "../src/mint.js";

function scriptedHttp(routes: Record<string, { status?: number; data: unknown }>): {
  http: MintHttp;
  calls: MintRequest[];
} {
  const calls: MintRequest[] = [];
  return {
    calls,
    http: {
      async request(req) {
        calls.push(req);
        const key = `${req.method} ${req.path.split("?")[0]}`;
        const route = routes[key] ?? routes[`${req.method} *`];
        if (!route) return { status: 404, body: { error: "no route" } };
        return { status: route.status ?? 200, body: { data: route.data } };
      },
    },
  };
}

const TYPED_DATA = {
  domain: { name: "Permit2" },
  types: {},
  primaryType: "PermitWitnessTransferFrom" as const,
  message: { permitted: { token: "0xusdc", amount: "100000000" } },
};

describe("createRfqClient (real StableFX OpenAPI shapes)", () => {
  it("requests a quote at /quotes and returns the typedData to sign", async () => {
    const { http, calls } = scriptedHttp({
      "POST /v1/exchange/stablefx/quotes": {
        data: {
          id: "q_1",
          rate: 0.92,
          from: { currency: "USDC", amount: "100" },
          to: { currency: "EURC", amount: "92" },
          createdAt: "t",
          expiresAt: "t+30",
          typedData: TYPED_DATA,
        },
      },
    });
    const quote = await createRfqClient({ http }).requestQuote({
      from: { currency: "USDC", amount: "100" },
      to: { currency: "EURC" },
      tenor: "instant",
      type: "tradable",
    });
    expect(calls[0]?.path).toBe("/v1/exchange/stablefx/quotes");
    expect(calls[0]?.body).toMatchObject({ tenor: "instant", type: "tradable" });
    expect(quote.id).toBe("q_1");
    expect(quote.typedData.primaryType).toBe("PermitWitnessTransferFrom");
  });

  it("creates a trade with the taker Permit2 message + signature", async () => {
    const { http, calls } = scriptedHttp({
      "POST /v1/exchange/stablefx/trades": {
        data: { id: "t_1", quoteId: "q_1", status: "pending_settlement", rate: 0.92, from: {}, to: {}, tenor: "instant" },
      },
    });
    const trade = await createRfqClient({ http }).createTrade({
      quoteId: "q_1",
      address: "0xtaker",
      message: TYPED_DATA.message,
      signature: "0xsig",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    });
    expect(calls[0]?.path).toBe("/v1/exchange/stablefx/trades");
    expect(calls[0]?.body).toMatchObject({ quoteId: "q_1", address: "0xtaker", signature: "0xsig" });
    expect(trade.status).toBe("pending_settlement");
  });

  it("registers a maker signature at /signatures", async () => {
    const { http, calls } = scriptedHttp({
      "POST /v1/exchange/stablefx/signatures": { data: { tradeId: "t_1", createDate: "t", updateDate: "t" } },
    });
    const res = await createRfqClient({ http }).registerMakerSignature({
      tradeId: "t_1",
      address: "0xmaker",
      details: { foo: 1 },
      signature: "0xmakersig",
    });
    expect(calls[0]?.path).toBe("/v1/exchange/stablefx/signatures");
    expect(res.tradeId).toBe("t_1");
  });

  it("reads a trade and the presign data", async () => {
    const { http } = scriptedHttp({
      "GET /v1/exchange/stablefx/trades/t_1": { data: { id: "t_1", status: "settled", quoteId: "q_1", rate: 0.92, from: {}, to: {}, tenor: "instant" } },
      "GET /v1/exchange/stablefx/signatures/presign/t_1": { data: { typedData: TYPED_DATA } },
    });
    const client = createRfqClient({ http });
    expect((await client.getTrade("t_1")).id).toBe("t_1");
    expect((await client.getPresignData("t_1")).typedData.primaryType).toBe("PermitWitnessTransferFrom");
  });

  it("throws on an API error and requires an apiKey without an http transport", async () => {
    const { http } = scriptedHttp({ "POST /v1/exchange/stablefx/quotes": { status: 400, data: null } });
    await expect(
      createRfqClient({ http }).requestQuote({ from: { currency: "USDC", amount: "1" }, to: { currency: "EURC" }, tenor: "instant" }),
    ).rejects.toThrow(/StableFX/);
    expect(() => createRfqClient({})).toThrow(/apiKey/);
  });
});
