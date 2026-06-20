import { describe, expect, it, vi } from "vitest";
import { SettleKitError } from "@settlekit/common";
import { createWalletsClient, pollTransaction } from "../src/index.js";
import type {
  CircleTransactionResource,
  WalletsClient,
  WalletsHttp,
  WalletsRequest,
  WalletsResponse,
} from "../src/index.js";

/** In-memory transport that records requests and returns scripted responses. */
function recordingHttp(responder: (req: WalletsRequest) => WalletsResponse): {
  http: WalletsHttp;
  requests: WalletsRequest[];
} {
  const requests: WalletsRequest[] = [];
  const http: WalletsHttp = {
    async request(req: WalletsRequest): Promise<WalletsResponse> {
      requests.push(req);
      return responder(req);
    },
  };
  return { http, requests };
}

const CIPHER = "ZmFrZS1jaXBoZXJ0ZXh0"; // base64-ish placeholder ciphertext
const CE_PATH = "/v1/w3s/developer/transactions/contractExecution";

/** A minimal transaction resource for poll stubs. */
function tx(
  state: CircleTransactionResource["state"],
  extra: Partial<CircleTransactionResource> = {},
): CircleTransactionResource {
  return {
    id: "tx_ce_1",
    blockchain: "ETH-SEPOLIA",
    state,
    createDate: "2026-01-01T00:00:00Z",
    updateDate: "2026-01-01T00:00:00Z",
    ...extra,
  };
}

describe("createContractExecution", () => {
  it("posts the contract execution request shape", async () => {
    const { http, requests } = recordingHttp(() => ({
      status: 201,
      body: {
        data: {
          id: "tx_ce_1",
          blockchain: "ETH-SEPOLIA",
          state: "INITIATED",
          createDate: "2026-01-01T00:00:00Z",
          updateDate: "2026-01-01T00:00:00Z",
        },
      },
    }));
    const client = createWalletsClient({ apiKey: "k", http });

    const result = await client.createContractExecution({
      walletAddress: "0xwallet",
      blockchain: "ETH-SEPOLIA",
      contractAddress: "0xcontract",
      abiFunctionSignature: "mint(address,uint256)",
      abiParameters: ["0xrecipient", 1],
      feeLevel: "HIGH",
      refId: "agent_42",
      entitySecretCiphertext: CIPHER,
      idempotencyKey: "idem-ce",
    });

    const req = requests[0]!;
    expect(req.method).toBe("POST");
    expect(req.path).toBe(CE_PATH);
    expect(req.body).toMatchObject({
      walletAddress: "0xwallet",
      blockchain: "ETH-SEPOLIA",
      contractAddress: "0xcontract",
      abiFunctionSignature: "mint(address,uint256)",
      abiParameters: ["0xrecipient", 1],
      feeLevel: "HIGH",
      refId: "agent_42",
      entitySecretCiphertext: CIPHER,
      idempotencyKey: "idem-ce",
    });
    expect(result).toMatchObject({ id: "tx_ce_1", state: "INITIATED" });
  });

  it("defaults feeLevel to MEDIUM and does not mutate caller abiParameters", async () => {
    const { http, requests } = recordingHttp(() => ({
      status: 201,
      body: {
        data: {
          id: "tx_ce_2",
          blockchain: "ETH-SEPOLIA",
          state: "INITIATED",
          createDate: "2026-01-01T00:00:00Z",
          updateDate: "2026-01-01T00:00:00Z",
        },
      },
    }));
    const client = createWalletsClient({ apiKey: "k", http });
    const params: readonly (string | number | boolean)[] = ["0xrecipient", 5, true];

    await client.createContractExecution({
      walletAddress: "0xwallet",
      blockchain: "ETH-SEPOLIA",
      contractAddress: "0xcontract",
      abiFunctionSignature: "approve(address,uint256)",
      abiParameters: params,
      entitySecretCiphertext: CIPHER,
    });

    const body = requests[0]!.body as { feeLevel: string; abiParameters: unknown[] };
    expect(body.feeLevel).toBe("MEDIUM");
    // Fresh array, not the same reference.
    expect(body.abiParameters).not.toBe(params);
    expect(body.abiParameters).toEqual(["0xrecipient", 5, true]);
  });

  it("resolves the entity secret via the provider when no per-call ciphertext is given", async () => {
    let calls = 0;
    const { http, requests } = recordingHttp(() => ({
      status: 201,
      body: {
        data: {
          id: "tx_ce_3",
          blockchain: "ETH-SEPOLIA",
          state: "INITIATED",
          createDate: "2026-01-01T00:00:00Z",
          updateDate: "2026-01-01T00:00:00Z",
        },
      },
    }));
    const client = createWalletsClient({
      apiKey: "k",
      http,
      entitySecretProvider: () => {
        calls += 1;
        return `cipher-${calls}`;
      },
    });

    await client.createContractExecution({
      walletAddress: "0xwallet",
      blockchain: "ETH-SEPOLIA",
      contractAddress: "0xcontract",
      abiFunctionSignature: "mint(address,uint256)",
      abiParameters: ["0xrecipient", 1],
    });

    expect(calls).toBe(1);
    expect((requests[0]!.body as { entitySecretCiphertext: string }).entitySecretCiphertext).toBe(
      "cipher-1",
    );
  });

  it("rejects when no entity secret source is available", async () => {
    const { http } = recordingHttp(() => ({ status: 201, body: { data: tx("INITIATED") } }));
    const client = createWalletsClient({ apiKey: "k", http });
    await expect(
      client.createContractExecution({
        walletAddress: "0xwallet",
        blockchain: "ETH-SEPOLIA",
        contractAddress: "0xcontract",
        abiFunctionSignature: "mint(address,uint256)",
        abiParameters: [],
      }),
    ).rejects.toThrow(/entitySecretCiphertext/);
  });

  it("rejects a missing contractAddress with a validation error", async () => {
    const { http } = recordingHttp(() => ({ status: 201, body: { data: tx("INITIATED") } }));
    const client = createWalletsClient({ apiKey: "k", http });
    await expect(
      client.createContractExecution({
        walletAddress: "0xwallet",
        blockchain: "ETH-SEPOLIA",
        contractAddress: "",
        abiFunctionSignature: "mint(address,uint256)",
        abiParameters: [],
        entitySecretCiphertext: CIPHER,
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
  });

  it("rejects an empty abiFunctionSignature with a validation error", async () => {
    const { http } = recordingHttp(() => ({ status: 201, body: { data: tx("INITIATED") } }));
    const client = createWalletsClient({ apiKey: "k", http });
    await expect(
      client.createContractExecution({
        walletAddress: "0xwallet",
        blockchain: "ETH-SEPOLIA",
        contractAddress: "0xcontract",
        abiFunctionSignature: "",
        abiParameters: [],
        entitySecretCiphertext: CIPHER,
      }),
    ).rejects.toBeInstanceOf(SettleKitError);
  });
});

/** Build a stub client exposing only getTransaction, scripted by a queue. */
function stubClient(states: CircleTransactionResource[]): {
  client: Pick<WalletsClient, "getTransaction">;
  getTransaction: ReturnType<typeof vi.fn>;
} {
  let i = 0;
  const getTransaction = vi.fn(async () => {
    const next = states[Math.min(i, states.length - 1)]!;
    i += 1;
    return next;
  });
  return { client: { getTransaction }, getTransaction };
}

describe("pollTransaction", () => {
  it("polls until COMPLETE and returns the transaction with txHash", async () => {
    const { client, getTransaction } = stubClient([
      tx("CONFIRMED"),
      tx("CONFIRMED"),
      tx("COMPLETE", { txHash: "0xhash" }),
    ]);
    const sleep = vi.fn(async () => {});

    const result = await pollTransaction(client, {
      id: "tx_ce_1",
      attempts: 5,
      delayMs: 1000,
      sleep,
    });

    expect(result.txHash).toBe("0xhash");
    expect(getTransaction).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(sleep).toHaveBeenNthCalledWith(2, 1000);
  });

  it("throws on a FAILED terminal state carrying error fields", async () => {
    const { client } = stubClient([
      tx("FAILED", { errorReason: "reverted", errorDetails: "OOG" }),
    ]);
    const sleep = vi.fn(async () => {});

    await expect(
      pollTransaction(client, { id: "tx_ce_1", attempts: 5, delayMs: 1000, sleep }),
    ).rejects.toMatchObject({
      code: "integration_error",
      details: { state: "FAILED", errorReason: "reverted", errorDetails: "OOG" },
    });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("throws on a CANCELLED terminal state", async () => {
    const { client } = stubClient([tx("CANCELLED")]);
    await expect(
      pollTransaction(client, { id: "tx_ce_1", attempts: 5, sleep: async () => {} }),
    ).rejects.toMatchObject({ code: "integration_error", details: { state: "CANCELLED" } });
  });

  it("times out with a retryable error after exhausting attempts", async () => {
    const { client, getTransaction } = stubClient([tx("SENT")]);
    const sleep = vi.fn(async () => {});

    await expect(
      pollTransaction(client, { id: "tx_ce_1", attempts: 3, delayMs: 500, sleep }),
    ).rejects.toMatchObject({
      code: "integration_error",
      retryable: true,
      details: { state: "SENT", attempts: 3 },
    });
    expect(getTransaction).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2); // no sleep after the final attempt
  });

  it("rejects an empty id with a validation error", async () => {
    const { client } = stubClient([tx("COMPLETE", { txHash: "0xhash" })]);
    await expect(
      pollTransaction(client, { id: "", sleep: async () => {} }),
    ).rejects.toMatchObject({ code: "validation_error" });
  });
});
