import { describe, expect, it } from "vitest";
import { SettleKitError } from "@settlekit/common";
import { createWalletsClient } from "../src/index.js";
import type { WalletsHttp, WalletsRequest, WalletsResponse } from "../src/index.js";

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

describe("createWalletsClient", () => {
  it("requires an apiKey", () => {
    expect(() => createWalletsClient({ apiKey: "" })).toThrow(SettleKitError);
  });

  it("createWalletSet posts to the developer walletSets endpoint with the ciphertext", async () => {
    const { http, requests } = recordingHttp(() => ({
      status: 201,
      body: {
        data: {
          walletSet: {
            id: "ws_1",
            name: "treasury",
            custodyType: "DEVELOPER",
            createDate: "2026-01-01T00:00:00Z",
            updateDate: "2026-01-01T00:00:00Z",
          },
        },
      },
    }));
    const client = createWalletsClient({ apiKey: "k", http });
    // Note: response is unwrapped at `.data`, so the walletSet wrapper is the data payload here.
    const data = await client.createWalletSet({
      name: "treasury",
      entitySecretCiphertext: CIPHER,
      idempotencyKey: "idem-1",
    });

    const req = requests[0]!;
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/v1/w3s/developer/walletSets");
    expect(req.body).toMatchObject({
      name: "treasury",
      entitySecretCiphertext: CIPHER,
      idempotencyKey: "idem-1",
    });
    // The data payload here is `{ walletSet: {...} }`.
    expect(data).toMatchObject({ walletSet: { id: "ws_1" } });
  });

  it("createWallets validates inputs and parses the wallets array", async () => {
    const { http, requests } = recordingHttp(() => ({
      status: 201,
      body: {
        data: {
          wallets: [
            {
              id: "wallet_1",
              address: "0xabc",
              blockchain: "ETH-SEPOLIA",
              walletSetId: "ws_1",
              custodyType: "DEVELOPER",
              accountType: "EOA",
              state: "LIVE",
              createDate: "2026-01-01T00:00:00Z",
              updateDate: "2026-01-01T00:00:00Z",
            },
          ],
        },
      },
    }));
    const client = createWalletsClient({ apiKey: "k", http });

    const wallets = await client.createWallets({
      walletSetId: "ws_1",
      blockchains: ["ETH-SEPOLIA"],
      count: 1,
      accountType: "EOA",
      entitySecretCiphertext: CIPHER,
    });

    const req = requests[0]!;
    expect(req.path).toBe("/v1/w3s/developer/wallets");
    expect(req.body).toMatchObject({
      walletSetId: "ws_1",
      blockchains: ["ETH-SEPOLIA"],
      count: 1,
      accountType: "EOA",
      entitySecretCiphertext: CIPHER,
    });
    expect(wallets).toHaveLength(1);
    expect(wallets[0]).toMatchObject({ id: "wallet_1", address: "0xabc" });
  });

  it("createWallets rejects an empty blockchains list", async () => {
    const { http } = recordingHttp(() => ({ status: 200, body: { data: { wallets: [] } } }));
    const client = createWalletsClient({ apiKey: "k", http });
    await expect(
      client.createWallets({ walletSetId: "ws_1", blockchains: [], entitySecretCiphertext: CIPHER }),
    ).rejects.toThrow(/at least one blockchain/);
  });

  it("uses the entitySecretProvider when no per-call ciphertext is given", async () => {
    let calls = 0;
    const { http, requests } = recordingHttp(() => ({
      status: 201,
      body: { data: { wallets: [] } },
    }));
    const client = createWalletsClient({
      apiKey: "k",
      http,
      entitySecretProvider: () => {
        calls += 1;
        return `cipher-${calls}`;
      },
    });
    await client.createWallets({ walletSetId: "ws_1", blockchains: ["ETH"] });
    expect(calls).toBe(1);
    expect((requests[0]!.body as { entitySecretCiphertext: string }).entitySecretCiphertext).toBe(
      "cipher-1",
    );
  });

  it("throws a validation error when no entity secret source is available", async () => {
    const { http } = recordingHttp(() => ({ status: 201, body: { data: { wallets: [] } } }));
    const client = createWalletsClient({ apiKey: "k", http });
    await expect(
      client.createWallets({ walletSetId: "ws_1", blockchains: ["ETH"] }),
    ).rejects.toThrow(/entitySecretCiphertext/);
  });

  it("listWallets builds query params and drops undefined values", async () => {
    const { http, requests } = recordingHttp(() => ({
      status: 200,
      body: { data: { wallets: [] } },
    }));
    const client = createWalletsClient({ apiKey: "k", http });
    await client.listWallets({ walletSetId: "ws_1", pageSize: 50 });
    const req = requests[0]!;
    expect(req.method).toBe("GET");
    expect(req.path).toBe("/v1/w3s/wallets");
    expect(req.query).toMatchObject({ walletSetId: "ws_1", pageSize: "50" });
    expect(req.query?.blockchain).toBeUndefined();
  });

  it("getWalletBalance returns the tokenBalances array", async () => {
    const { http, requests } = recordingHttp(() => ({
      status: 200,
      body: {
        data: {
          tokenBalances: [
            {
              token: {
                id: "tok_usdc",
                blockchain: "ETH-SEPOLIA",
                symbol: "USDC",
                decimals: 6,
                isNative: false,
              },
              amount: "12.5",
              updateDate: "2026-01-01T00:00:00Z",
            },
          ],
        },
      },
    }));
    const client = createWalletsClient({ apiKey: "k", http });
    const balances = await client.getWalletBalance("wallet_1");
    expect(requests[0]!.path).toBe("/v1/w3s/wallets/wallet_1/balances");
    expect(balances[0]).toMatchObject({ amount: "12.5", token: { symbol: "USDC" } });
  });

  it("createTransfer posts amounts as an array with feeLevel and ciphertext", async () => {
    const { http, requests } = recordingHttp(() => ({
      status: 201,
      body: {
        data: {
          id: "tx_1",
          blockchain: "ETH-SEPOLIA",
          walletId: "wallet_1",
          destinationAddress: "0xdest",
          tokenId: "tok_usdc",
          amounts: ["25.5"],
          state: "INITIATED",
          createDate: "2026-01-01T00:00:00Z",
          updateDate: "2026-01-01T00:00:00Z",
        },
      },
    }));
    const client = createWalletsClient({ apiKey: "k", http });
    const tx = await client.createTransfer({
      walletId: "wallet_1",
      destinationAddress: "0xdest",
      tokenId: "tok_usdc",
      amount: "25.5",
      refId: "payout_42",
      entitySecretCiphertext: CIPHER,
    });
    const req = requests[0]!;
    expect(req.path).toBe("/v1/w3s/developer/transactions/transfer");
    expect(req.body).toMatchObject({
      walletId: "wallet_1",
      destinationAddress: "0xdest",
      tokenId: "tok_usdc",
      amounts: ["25.5"],
      feeLevel: "MEDIUM",
      refId: "payout_42",
      entitySecretCiphertext: CIPHER,
    });
    expect(tx).toMatchObject({ id: "tx_1", state: "INITIATED" });
  });

  it("getTransaction unwraps the transaction object", async () => {
    const { http, requests } = recordingHttp(() => ({
      status: 200,
      body: {
        data: {
          transaction: {
            id: "tx_1",
            blockchain: "ETH-SEPOLIA",
            state: "COMPLETE",
            txHash: "0xhash",
            createDate: "2026-01-01T00:00:00Z",
            updateDate: "2026-01-01T00:05:00Z",
          },
        },
      },
    }));
    const client = createWalletsClient({ apiKey: "k", http });
    const tx = await client.getTransaction("tx_1");
    expect(requests[0]!.path).toBe("/v1/w3s/transactions/tx_1");
    expect(tx).toMatchObject({ id: "tx_1", state: "COMPLETE", txHash: "0xhash" });
  });

  it("maps non-2xx responses to a SettleKitError carrying the Circle error body", async () => {
    const { http } = recordingHttp(() => ({
      status: 401,
      body: { code: 401, message: "Malformed authorization" },
    }));
    const client = createWalletsClient({ apiKey: "k", http });
    await expect(client.listWallets()).rejects.toMatchObject({
      code: "integration_error",
      message: "Malformed authorization",
    });
  });

  it("throws when the data envelope is missing", async () => {
    const { http } = recordingHttp(() => ({ status: 200, body: { wallets: [] } }));
    const client = createWalletsClient({ apiKey: "k", http });
    await expect(client.listWallets()).rejects.toThrow(/missing the data envelope/);
  });
});
