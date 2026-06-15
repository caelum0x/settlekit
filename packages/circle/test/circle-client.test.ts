import { describe, expect, it } from "vitest";
import { SettleKitError } from "@settlekit/common";
import { buildUrl, createCircleClient } from "../src/index.js";
import type { CircleHttp, CircleRequest, CircleResponse } from "../src/index.js";

/**
 * In-memory CircleHttp test double: records the requests it receives and
 * replays a queue of canned responses. This is a real implementation of OUR
 * transport interface, used to drive the client's pure request/response logic.
 */
function recordingHttp(responses: CircleResponse[]): {
  http: CircleHttp;
  requests: CircleRequest[];
} {
  const requests: CircleRequest[] = [];
  const queue = [...responses];
  const http: CircleHttp = {
    async request(req: CircleRequest): Promise<CircleResponse> {
      requests.push(req);
      const next = queue.shift();
      if (!next) throw new Error("no canned response queued");
      return next;
    },
  };
  return { http, requests };
}

const PAYMENT_INTENT = {
  id: "pi_abc123",
  amount: { amount: "25.500000", currency: "USDC" },
  amountPaid: { amount: "25.5", currency: "USDC" },
  settlementCurrency: "USDC",
  paymentMethods: [{ type: "blockchain", chain: "BASE" }],
  status: "complete",
  createDate: "2026-06-14T10:00:00.000Z",
  updateDate: "2026-06-14T10:05:00.000Z",
  expiresOn: "2026-06-14T11:00:00.000Z",
};

describe("createCircleClient", () => {
  it("validates apiKey", () => {
    expect(() => createCircleClient({ apiKey: "" })).toThrow(SettleKitError);
  });

  it("builds createPaymentIntent request with correct method/url path/body", async () => {
    const { http, requests } = recordingHttp([{ status: 201, body: { data: PAYMENT_INTENT } }]);
    const client = createCircleClient({ apiKey: "test-key", http });

    const intent = await client.createPaymentIntent({
      amount: "25.50",
      currency: "USD",
      settlementCurrency: "USDC",
      chain: "BASE",
      idempotencyKey: "idem-1",
    });

    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/v1/paymentIntents");
    expect(req.body).toEqual({
      idempotencyKey: "idem-1",
      amount: { amount: "25.5", currency: "USD" },
      settlementCurrency: "USDC",
      paymentMethods: [{ type: "blockchain", chain: "BASE" }],
    });

    // Amount normalized into shared Money.
    expect(intent.amount).toEqual({ amount: "25.5", currency: "USDC" });
    expect(intent.amountPaid).toEqual({ amount: "25.5", currency: "USDC" });
    expect(intent.chains).toEqual(["BASE"]);
    expect(intent.status).toBe("complete");
    expect(intent.createdAt).toBe("2026-06-14T10:00:00.000Z");
    expect(intent.expiresAt).toBe("2026-06-14T11:00:00.000Z");
  });

  it("builds getPaymentIntent GET request and encodes id", async () => {
    const { http, requests } = recordingHttp([{ status: 200, body: { data: PAYMENT_INTENT } }]);
    const client = createCircleClient({ apiKey: "k", http });

    await client.getPaymentIntent("pi abc/123");

    expect(requests[0]!.method).toBe("GET");
    expect(requests[0]!.path).toBe("/v1/paymentIntents/pi%20abc%2F123");
    expect(requests[0]!.body).toBeUndefined();
  });

  it("maps a non-2xx Circle error body to SettleKitError(integration_error)", async () => {
    const circleError = { code: 2, message: "Invalid blockchain address" };
    const { http } = recordingHttp([{ status: 400, body: circleError }]);
    const client = createCircleClient({ apiKey: "k", http });

    await expect(
      client.createPaymentIntent({
        amount: "10",
        currency: "USDC",
        settlementCurrency: "USDC",
        chain: "ETH",
      }),
    ).rejects.toMatchObject({
      code: "integration_error",
      message: "Invalid blockchain address",
      details: {
        status: 400,
        circleError,
        request: { method: "POST", path: "/v1/paymentIntents" },
      },
    });
  });

  it("marks 5xx/429 errors retryable", async () => {
    const { http } = recordingHttp([{ status: 503, body: { message: "upstream down" } }]);
    const client = createCircleClient({ apiKey: "k", http });

    const error = await client.getPaymentIntent("pi_1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SettleKitError);
    expect((error as SettleKitError).retryable).toBe(true);
  });

  it("throws when the success envelope is missing the data field", async () => {
    const { http } = recordingHttp([{ status: 200, body: { id: "pi_1" } }]);
    const client = createCircleClient({ apiKey: "k", http });

    await expect(client.getPaymentIntent("pi_1")).rejects.toMatchObject({
      code: "integration_error",
    });
  });

  it("creates a payout and normalizes amount + fees", async () => {
    const payout = {
      id: "payout_1",
      amount: { amount: "100.000000", currency: "USDC" },
      fees: { amount: "0.250000", currency: "USDC" },
      status: "pending",
      sourceWalletId: "wallet_9",
      destination: { type: "blockchain", address: "0xabc", chain: "BASE" },
      createDate: "2026-06-14T10:00:00.000Z",
      updateDate: "2026-06-14T10:00:01.000Z",
      trackingRef: "TRK-1",
    };
    const { http, requests } = recordingHttp([{ status: 201, body: { data: payout } }]);
    const client = createCircleClient({ apiKey: "k", http });

    const result = await client.createPayout({
      amount: "100",
      currency: "USDC",
      sourceWalletId: "wallet_9",
      destination: { type: "blockchain", address: "0xabc", chain: "BASE" },
    });

    expect(requests[0]!.method).toBe("POST");
    expect(requests[0]!.path).toBe("/v1/payouts");
    expect(requests[0]!.body).toMatchObject({
      source: { type: "wallet", id: "wallet_9" },
      destination: { type: "blockchain", address: "0xabc", chain: "BASE" },
      amount: { amount: "100", currency: "USDC" },
    });
    expect(result.amount).toEqual({ amount: "100", currency: "USDC" });
    expect(result.fees).toEqual({ amount: "0.25", currency: "USDC" });
    expect(result.status).toBe("pending");
  });

  it("lists transfers with query params and normalizes amounts", async () => {
    const transfers = [
      {
        id: "transfer_1",
        source: { type: "wallet", id: "w1" },
        destination: { type: "blockchain", address: "0xdef", chain: "BASE" },
        amount: { amount: "5.000000", currency: "USDC" },
        status: "complete",
        transactionHash: "0xhash",
        createDate: "2026-06-14T10:00:00.000Z",
      },
    ];
    const { http, requests } = recordingHttp([{ status: 200, body: { data: transfers } }]);
    const client = createCircleClient({ apiKey: "k", http });

    const result = await client.listTransfers({ walletId: "w1", pageSize: 50 });

    expect(requests[0]!.method).toBe("GET");
    expect(requests[0]!.path).toBe("/v1/transfers");
    expect(requests[0]!.query).toEqual({
      walletId: "w1",
      pageSize: "50",
      pageBefore: undefined,
      pageAfter: undefined,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.amount).toEqual({ amount: "5", currency: "USDC" });
    expect(result[0]!.transactionHash).toBe("0xhash");
  });

  it("validates required inputs before issuing a request", async () => {
    const { http, requests } = recordingHttp([]);
    const client = createCircleClient({ apiKey: "k", http });

    await expect(client.getPayout("")).rejects.toMatchObject({ code: "validation_error" });
    expect(requests).toHaveLength(0);
  });
});

describe("buildUrl", () => {
  it("joins base + path and serializes defined query params", () => {
    const url = buildUrl("https://api.circle.com/", "/v1/transfers", {
      walletId: "w1",
      pageSize: "25",
      pageAfter: undefined,
    });
    expect(url).toBe("https://api.circle.com/v1/transfers?walletId=w1&pageSize=25");
  });
});
