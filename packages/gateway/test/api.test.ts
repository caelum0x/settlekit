import { describe, expect, it } from "vitest";
import {
  assertGatewayOk,
  buildGatewayUrl,
  createGatewayApi,
  parseApiBalances,
  parseTransferAttestation,
} from "../src/api.js";
import type { GatewayHttp, GatewayRequest, GatewayResponse } from "../src/api.js";
import type { SignedBurnIntent } from "../src/types.js";

/** In-memory transport that records requests and replays a queued response. */
function stubHttp(response: GatewayResponse): {
  http: GatewayHttp;
  calls: GatewayRequest[];
} {
  const calls: GatewayRequest[] = [];
  return {
    calls,
    http: {
      async request(req: GatewayRequest): Promise<GatewayResponse> {
        calls.push(req);
        return response;
      },
    },
  };
}

const SIGNED: SignedBurnIntent = {
  signature: "0xabcd",
  burnIntent: {
    maxBlockHeight: "100",
    maxFee: "10",
    spec: {
      version: 1,
      sourceDomain: 0,
      destinationDomain: 26,
      sourceContract: `0x${"0".repeat(64)}`,
      destinationContract: `0x${"0".repeat(64)}`,
      sourceToken: `0x${"0".repeat(64)}`,
      destinationToken: `0x${"0".repeat(64)}`,
      sourceDepositor: `0x${"0".repeat(64)}`,
      destinationRecipient: `0x${"0".repeat(64)}`,
      sourceSigner: `0x${"0".repeat(64)}`,
      destinationCaller: `0x${"0".repeat(64)}`,
      value: "1000000",
      salt: `0x${"ab".repeat(32)}`,
      hookData: "0x",
    },
  },
};

describe("buildGatewayUrl", () => {
  it("joins base, path, and query without double slashes", () => {
    expect(buildGatewayUrl("https://x.test/", "/v1/transfer")).toBe(
      "https://x.test/v1/transfer",
    );
    expect(
      buildGatewayUrl("https://x.test", "/v1/transfer", { enableForwarder: "true" }),
    ).toBe("https://x.test/v1/transfer?enableForwarder=true");
  });
});

describe("assertGatewayOk", () => {
  const req: GatewayRequest = { method: "POST", path: "/v1/transfer" };

  it("passes 2xx", () => {
    expect(() => assertGatewayOk({ status: 200, body: {} }, req)).not.toThrow();
  });

  it("maps a 4xx to integration_error and surfaces the message", () => {
    expect(() =>
      assertGatewayOk({ status: 400, body: { message: "bad intent" } }, req),
    ).toThrow(/bad intent/);
  });

  it("marks 5xx and 429 retryable", () => {
    try {
      assertGatewayOk({ status: 503, body: {} }, req);
    } catch (e) {
      expect((e as { retryable?: boolean }).retryable).toBe(true);
    }
  });
});

describe("parseTransferAttestation", () => {
  it("parses attestation + signature and optional fee/expiry", () => {
    const out = parseTransferAttestation({
      transferId: "abc",
      attestation: "0xdead",
      signature: "0xbeef",
      fees: { total: "1.1", token: "USDC", perIntent: [] },
      expirationBlock: "1900",
    });
    expect(out.transferId).toBe("abc");
    expect(out.attestation).toBe("0xdead");
    expect(out.signature).toBe("0xbeef");
    expect(out.fees?.total).toBe("1.1");
    expect(out.expirationBlock).toBe("1900");
  });

  it("throws when attestation is missing", () => {
    expect(() => parseTransferAttestation({ signature: "0xbeef" })).toThrow(
      /attestation/,
    );
  });
});

describe("parseApiBalances", () => {
  it("parses per-domain balances", () => {
    const out = parseApiBalances({
      balances: [
        { domain: 0, balance: "5.0" },
        { domain: 26, balance: "10.5" },
      ],
    });
    expect(out).toEqual([
      { domain: 0, balance: "5.0" },
      { domain: 26, balance: "10.5" },
    ]);
  });

  it("throws when balances is not an array", () => {
    expect(() => parseApiBalances({})).toThrow(/balances array/);
  });
});

describe("createGatewayApi.requestTransferAttestation", () => {
  it("POSTs the intents array to /v1/transfer and parses the response", async () => {
    const { http, calls } = stubHttp({
      status: 200,
      body: { transferId: "t1", attestation: "0xaa", signature: "0xbb" },
    });
    const api = createGatewayApi(http);
    const out = await api.requestTransferAttestation([SIGNED]);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].path).toBe("/v1/transfer");
    expect(calls[0].body).toEqual([SIGNED]);
    expect(out.attestation).toBe("0xaa");
  });

  it("adds the enableForwarder query when requested", async () => {
    const { http, calls } = stubHttp({
      status: 200,
      body: { attestation: "0xaa", signature: "0xbb" },
    });
    const api = createGatewayApi(http);
    await api.requestTransferAttestation([SIGNED], { enableForwarder: true });
    expect(calls[0].query).toEqual({ enableForwarder: "true" });
  });

  it("rejects an empty intent list", async () => {
    const { http } = stubHttp({ status: 200, body: {} });
    await expect(createGatewayApi(http).requestTransferAttestation([])).rejects.toThrow(
      /at least one/,
    );
  });

  it("rejects more than 16 intents", async () => {
    const { http } = stubHttp({ status: 200, body: {} });
    const many = Array.from({ length: 17 }, () => SIGNED);
    await expect(
      createGatewayApi(http).requestTransferAttestation(many),
    ).rejects.toThrow(/at most 16/);
  });

  it("propagates a non-2xx as an error", async () => {
    const { http } = stubHttp({ status: 422, body: { message: "expired" } });
    await expect(
      createGatewayApi(http).requestTransferAttestation([SIGNED]),
    ).rejects.toThrow(/expired/);
  });
});

describe("createGatewayApi.getBalances", () => {
  it("POSTs token + sources to /v1/balances and parses the result", async () => {
    const { http, calls } = stubHttp({
      status: 200,
      body: { balances: [{ domain: 0, balance: "5.0" }] },
    });
    const api = createGatewayApi(http);
    const out = await api.getBalances("USDC", [
      { domain: 0, depositor: "0x1111111111111111111111111111111111111111" },
    ]);
    expect(calls[0].path).toBe("/v1/balances");
    expect(calls[0].body).toEqual({
      token: "USDC",
      sources: [{ domain: 0, depositor: "0x1111111111111111111111111111111111111111" }],
    });
    expect(out[0].balance).toBe("5.0");
  });

  it("rejects an empty sources list", async () => {
    const { http } = stubHttp({ status: 200, body: {} });
    await expect(createGatewayApi(http).getBalances("USDC", [])).rejects.toThrow(
      /at least one source/,
    );
  });
});
