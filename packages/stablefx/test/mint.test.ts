import { describe, expect, it } from "vitest";
import { SettleKitError } from "@settlekit/common";
import {
  buildMintUrl,
  createFetchMintHttp,
  createMintClient,
} from "../src/index.js";
import type { MintHttp, MintRequest, MintResponse } from "../src/index.js";

/**
 * In-memory MintHttp test double: records requests and replays canned
 * responses. A real implementation of OUR transport interface, used to drive
 * the client's pure request/response logic without the network.
 */
function recordingHttp(responses: MintResponse[]): {
  http: MintHttp;
  requests: MintRequest[];
} {
  const requests: MintRequest[] = [];
  const queue = [...responses];
  const http: MintHttp = {
    async request(req: MintRequest): Promise<MintResponse> {
      requests.push(req);
      const next = queue.shift();
      if (!next) throw new Error("no canned response queued");
      return next;
    },
  };
  return { http, requests };
}

const MINT_TRANSFER = {
  id: "transfer_abc",
  amount: { amount: "1000.00", currency: "EURC" },
  status: "pending",
  destination: { type: "blockchain", address: "0xabc", chain: "ARC" },
  createDate: "2026-06-16T10:00:00.000Z",
  updateDate: "2026-06-16T10:00:00.000Z",
};

const REDEEM_PAYOUT = {
  id: "payout_xyz",
  amount: { amount: "500.00", currency: "USDC" },
  status: "pending",
  sourceWalletId: "1000123",
  trackingRef: "CIR-REF-1",
  createDate: "2026-06-16T11:00:00.000Z",
  updateDate: "2026-06-16T11:00:00.000Z",
};

describe("createMintClient", () => {
  it("requires an apiKey unless http is injected", () => {
    expect(() => createMintClient({})).toThrow(SettleKitError);
  });

  it("builds createMint as a verified_blockchain transfer", async () => {
    const { http, requests } = recordingHttp([
      { status: 201, body: { data: MINT_TRANSFER } },
    ]);
    const client = createMintClient({ http });

    const mint = await client.createMint({
      amount: "1000.00",
      currency: "EURC",
      destinationAddressId: "addr_1",
      idempotencyKey: "idem-1",
    });

    const req = requests[0]!;
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/v1/businessAccount/transfers");
    expect(req.body).toEqual({
      idempotencyKey: "idem-1",
      destination: { type: "verified_blockchain", addressId: "addr_1" },
      amount: { amount: "1000.00", currency: "EURC" },
    });

    expect(mint.id).toBe("transfer_abc");
    expect(mint.amount).toEqual({ amount: "1000.00", currency: "EURC" });
    expect(mint.status).toBe("pending");
    expect(mint.chain).toBe("ARC");
    expect(mint.destinationAddress).toBe("0xabc");
  });

  it("builds createRedeem as a wire payout", async () => {
    const { http, requests } = recordingHttp([
      { status: 201, body: { data: REDEEM_PAYOUT } },
    ]);
    const client = createMintClient({ http });

    const redeem = await client.createRedeem({
      amount: "500.00",
      currency: "USDC",
      bankAccountId: "bank_9",
      idempotencyKey: "idem-2",
    });

    const req = requests[0]!;
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/v1/businessAccount/payouts");
    expect(req.body).toEqual({
      idempotencyKey: "idem-2",
      destination: { type: "wire", id: "bank_9" },
      amount: { amount: "500.00", currency: "USDC" },
    });

    expect(redeem.id).toBe("payout_xyz");
    expect(redeem.amount).toEqual({ amount: "500.00", currency: "USDC" });
    expect(redeem.sourceWalletId).toBe("1000123");
    expect(redeem.trackingRef).toBe("CIR-REF-1");
  });

  it("getMint fetches by id and parses the resource", async () => {
    const { http, requests } = recordingHttp([
      { status: 200, body: { data: { ...MINT_TRANSFER, status: "complete", transactionHash: "0xdead" } } },
    ]);
    const client = createMintClient({ http });

    const mint = await client.getMint("transfer_abc");
    expect(requests[0]!.method).toBe("GET");
    expect(requests[0]!.path).toBe("/v1/businessAccount/transfers/transfer_abc");
    expect(mint.status).toBe("complete");
    expect(mint.transactionHash).toBe("0xdead");
  });

  it("maps a non-2xx Circle error into a SettleKitError", async () => {
    const { http } = recordingHttp([
      { status: 422, body: { code: 2, message: "amount exceeds balance" } },
    ]);
    const client = createMintClient({ http });

    await expect(
      client.createMint({
        amount: "1.00",
        currency: "USDC",
        destinationAddressId: "addr_1",
      }),
    ).rejects.toMatchObject({
      code: "integration_error",
      message: "amount exceeds balance",
    });
  });

  it("rejects responses missing the data envelope", async () => {
    const { http } = recordingHttp([{ status: 200, body: { id: "no-envelope" } }]);
    const client = createMintClient({ http });
    await expect(client.getRedeem("payout_xyz")).rejects.toThrow(SettleKitError);
  });

  it("rejects an unsupported currency in the response", async () => {
    const { http } = recordingHttp([
      { status: 200, body: { data: { ...MINT_TRANSFER, amount: { amount: "1", currency: "GBP" } } } },
    ]);
    const client = createMintClient({ http });
    await expect(client.getMint("transfer_abc")).rejects.toThrow(SettleKitError);
  });

  it("validates input before any request is sent", async () => {
    const { http, requests } = recordingHttp([]);
    const client = createMintClient({ http });
    await expect(
      client.createMint({ amount: "", currency: "USDC", destinationAddressId: "a" }),
    ).rejects.toThrow(SettleKitError);
    expect(requests).toHaveLength(0);
  });
});

describe("createFetchMintHttp", () => {
  it("sends Authorization bearer + JSON headers and serialized body", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({ data: { id: "t_1" } }), { status: 201 });
    };
    const http = createFetchMintHttp({
      apiKey: "secret",
      baseUrl: "https://api.circle.com",
      fetchImpl: fakeFetch,
    });

    const res = await http.request({
      method: "POST",
      path: "/v1/businessAccount/transfers",
      body: { amount: { amount: "10", currency: "USDC" } },
    });

    expect(res.status).toBe(201);
    const call = calls[0]!;
    expect(call.url).toBe("https://api.circle.com/v1/businessAccount/transfers");
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Accept).toBe("application/json");
  });
});

describe("buildMintUrl", () => {
  it("joins base, path, and query", () => {
    expect(
      buildMintUrl("https://api.circle.com/", "/v1/businessAccount/payouts", {
        pageSize: "5",
        skip: undefined,
      }),
    ).toBe("https://api.circle.com/v1/businessAccount/payouts?pageSize=5");
  });
});
