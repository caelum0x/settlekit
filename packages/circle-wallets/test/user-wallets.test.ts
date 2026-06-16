import { describe, expect, it } from "vitest";
import { createUserWalletsClient } from "../src/user-wallets.js";
import type { WalletsHttp, WalletsRequest } from "../src/http.js";

function scripted(routes: Record<string, { status?: number; data?: unknown }>): {
  http: WalletsHttp;
  calls: WalletsRequest[];
} {
  const calls: WalletsRequest[] = [];
  return {
    calls,
    http: {
      async request(req) {
        calls.push(req);
        const route = routes[`${req.method} ${req.path}`] ?? routes[`${req.method} *`];
        if (!route) return { status: 404, body: { message: "no route" } };
        return { status: route.status ?? 200, body: { data: route.data } };
      },
    },
  };
}

const cfg = (http: WalletsHttp) => ({ apiKey: "k", http, idempotencyKey: () => "idem-1" });

describe("createUserWalletsClient", () => {
  it("creates a user", async () => {
    const { http, calls } = scripted({ "POST /v1/w3s/users": { data: {} } });
    const user = await createUserWalletsClient(cfg(http)).createUser("user_1");
    expect(user.id).toBe("user_1");
    expect(calls[0]?.body).toEqual({ userId: "user_1" });
  });

  it("mints a user token", async () => {
    const { http } = scripted({ "POST /v1/w3s/users/token": { data: { userToken: "ut_1", encryptionKey: "ek_1" } } });
    const token = await createUserWalletsClient(cfg(http)).createUserToken("user_1");
    expect(token).toEqual({ userToken: "ut_1", encryptionKey: "ek_1" });
  });

  it("creates an initialize challenge with the X-User-Token header", async () => {
    const { http, calls } = scripted({ "POST /v1/w3s/user/initialize": { data: { challengeId: "ch_1" } } });
    const ch = await createUserWalletsClient(cfg(http)).initializeUser("ut_1", { blockchains: ["ETH"] });
    expect(ch.challengeId).toBe("ch_1");
    expect(calls[0]?.headers?.["X-User-Token"]).toBe("ut_1");
    expect(calls[0]?.body).toMatchObject({ idempotencyKey: "idem-1", blockchains: ["ETH"] });
  });

  it("creates a transfer challenge carrying the user token", async () => {
    const { http, calls } = scripted({ "POST /v1/w3s/user/transactions/transfer": { data: { challengeId: "ch_2" } } });
    const ch = await createUserWalletsClient(cfg(http)).createTransferChallenge("ut_1", {
      walletId: "w_1",
      destinationAddress: "0xabc",
      tokenId: "tok_usdc",
      amount: "25.00",
    });
    expect(ch.challengeId).toBe("ch_2");
    expect(calls[0]?.headers?.["X-User-Token"]).toBe("ut_1");
    expect(calls[0]?.body).toMatchObject({ amounts: ["25.00"], feeLevel: "MEDIUM" });
  });

  it("lists the user's wallets", async () => {
    const { http, calls } = scripted({ "GET /v1/w3s/wallets": { data: { wallets: [{ id: "w_1" }] } } });
    const wallets = await createUserWalletsClient(cfg(http)).listWallets("ut_1");
    expect(wallets).toHaveLength(1);
    expect(calls[0]?.headers?.["X-User-Token"]).toBe("ut_1");
  });

  it("surfaces a Circle error", async () => {
    const { http } = scripted({ "POST /v1/w3s/users/token": { status: 401, data: null } });
    await expect(createUserWalletsClient(cfg(http)).createUserToken("user_1")).rejects.toThrow();
  });
});
