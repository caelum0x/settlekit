import { describe, expect, it } from "vitest";
import { SettleKitError } from "@settlekit/common";
import { buildUrl, createGasStationClient } from "../src/index.js";
import type {
  PaymasterHttp,
  PaymasterRequest,
  PaymasterResponse,
} from "../src/index.js";

/** Recording in-memory transport replaying canned responses. */
function recordingHttp(responses: PaymasterResponse[]): {
  http: PaymasterHttp;
  requests: PaymasterRequest[];
} {
  const requests: PaymasterRequest[] = [];
  const queue = [...responses];
  const http: PaymasterHttp = {
    async request(req) {
      requests.push(req);
      const next = queue.shift();
      if (!next) throw new Error("no canned response queued");
      return next;
    },
  };
  return { http, requests };
}

const POLICY = {
  id: "pol_123",
  name: "checkout-sponsor",
  blockchain: "ARC-TESTNET",
  status: "active",
  limits: {
    maxSpendPerTransaction: "0.50",
    maxSpendPerDay: "100.00",
    maxOperationsPerDay: 1000,
  },
  contractAddresses: ["0x2222222222222222222222222222222222222222"],
  createDate: "2026-06-16T00:00:00Z",
  updateDate: "2026-06-16T00:00:00Z",
};

describe("createGasStationClient", () => {
  it("requires an apiKey", () => {
    expect(() => createGasStationClient({ apiKey: "" })).toThrow(SettleKitError);
  });

  it("createPolicy POSTs to the policies path and normalizes the resource", async () => {
    const { http, requests } = recordingHttp([{ status: 200, body: { data: POLICY } }]);
    const client = createGasStationClient({ apiKey: "k", http });

    const policy = await client.createPolicy({
      name: "checkout-sponsor",
      blockchain: "ARC-TESTNET",
      limits: { maxSpendPerTransaction: "0.50", maxOperationsPerDay: 1000 },
      idempotencyKey: "idem-1",
    });

    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.path).toBe("/v1/w3s/gasStation/policies");
    expect(requests[0]?.body).toMatchObject({
      name: "checkout-sponsor",
      blockchain: "ARC-TESTNET",
      idempotencyKey: "idem-1",
    });
    expect(policy.id).toBe("pol_123");
    expect(policy.status).toBe("active");
    expect(policy.limits?.maxOperationsPerDay).toBe(1000);
  });

  it("getPolicy GETs the policy by id", async () => {
    const { http, requests } = recordingHttp([{ status: 200, body: { data: POLICY } }]);
    const client = createGasStationClient({ apiKey: "k", http });
    const policy = await client.getPolicy("pol_123");
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.path).toBe("/v1/w3s/gasStation/policies/pol_123");
    expect(policy.name).toBe("checkout-sponsor");
  });

  it("listPolicies passes the blockchain filter and maps the array", async () => {
    const { http, requests } = recordingHttp([
      { status: 200, body: { data: [POLICY, { ...POLICY, id: "pol_456" }] } },
    ]);
    const client = createGasStationClient({ apiKey: "k", http });
    const policies = await client.listPolicies("ARC-TESTNET");
    expect(requests[0]?.query).toEqual({ blockchain: "ARC-TESTNET" });
    expect(policies.map((p) => p.id)).toEqual(["pol_123", "pol_456"]);
  });

  it("setPolicyStatus PATCHes the status", async () => {
    const { http, requests } = recordingHttp([
      { status: 200, body: { data: { ...POLICY, status: "inactive" } } },
    ]);
    const client = createGasStationClient({ apiKey: "k", http });
    const policy = await client.setPolicyStatus("pol_123", false);
    expect(requests[0]?.method).toBe("PATCH");
    expect(requests[0]?.body).toEqual({ status: "inactive" });
    expect(policy.status).toBe("inactive");
  });

  it("honors a custom policiesPath", async () => {
    const { http, requests } = recordingHttp([{ status: 200, body: { data: POLICY } }]);
    const client = createGasStationClient({
      apiKey: "k",
      http,
      policiesPath: "/v2/gas/policies",
    });
    await client.getPolicy("pol_123");
    expect(requests[0]?.path).toBe("/v2/gas/policies/pol_123");
  });

  it("maps a non-2xx response to a SettleKitError with circle details", async () => {
    const { http } = recordingHttp([
      { status: 429, body: { code: 429, message: "rate limited" } },
    ]);
    const client = createGasStationClient({ apiKey: "k", http });
    await expect(client.getPolicy("pol_123")).rejects.toMatchObject({
      code: "integration_error",
      retryable: true,
    });
  });

  it("throws when the data envelope is missing", async () => {
    const { http } = recordingHttp([{ status: 200, body: { id: "pol_123" } }]);
    const client = createGasStationClient({ apiKey: "k", http });
    await expect(client.getPolicy("pol_123")).rejects.toBeInstanceOf(SettleKitError);
  });
});

describe("buildUrl", () => {
  it("joins base + path + query, trimming trailing slashes", () => {
    expect(
      buildUrl("https://api.circle.com/", "/v1/w3s/gasStation/policies", {
        blockchain: "ARC-TESTNET",
        skip: undefined,
      }),
    ).toBe("https://api.circle.com/v1/w3s/gasStation/policies?blockchain=ARC-TESTNET");
  });
});
