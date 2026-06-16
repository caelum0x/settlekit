/**
 * Circle **user-controlled** wallets (W3S) — customers self-custody via a PIN.
 *
 * Distinct from the developer-controlled client in `client.ts`: the user holds
 * the key material (gated by a PIN + security questions), so every sensitive
 * mutation returns a `challengeId` that the **client-side Circle SDK** completes
 * (PIN entry). The backend's job is to provision users, mint short-lived user
 * tokens, and create challenges — never to hold or complete them.
 *
 * Flow: createUser → createUserToken → initialize (PIN + first wallet challenge)
 * → [client SDK completes the challenge] → listWallets / createTransferChallenge.
 *
 * Endpoints (W3S, `Authorization: Bearer <apiKey>`; user-scoped calls also send
 * `X-User-Token: <userToken>`):
 *   POST /v1/w3s/users                        create a user
 *   POST /v1/w3s/users/token                  mint a 60-min user token (+ encryptionKey)
 *   POST /v1/w3s/user/initialize              PIN + wallet bootstrap challenge
 *   POST /v1/w3s/user/wallets                 create-wallet challenge
 *   POST /v1/w3s/user/transactions/transfer   transfer challenge
 *   GET  /v1/w3s/user                         read the user
 *   GET  /v1/w3s/wallets                      list the user's wallets
 *
 * Source: https://developers.circle.com/w3s (User-Controlled Wallets).
 */
import { SettleKitError } from "@settlekit/common";
import type { WalletsHttp, WalletsRequest } from "./http.js";
import { createFetchWalletsHttp } from "./http.js";
import { assertOk, unwrapData } from "./envelope.js";
import { DEFAULT_W3S_BASE_URL } from "./client.js";
import type {
  CircleAccountType,
  CircleBlockchain,
  CircleFeeLevel,
  CircleTokenBalance,
  CircleTransactionResource,
  CircleWalletResource,
} from "./types.js";

/** A short-lived user session token plus the SDK encryption key. */
export interface UserToken {
  userToken: string;
  encryptionKey: string;
}

/** The reference returned by every challenge-producing call. */
export interface UserChallenge {
  challengeId: string;
}

export interface CreateUserWalletChallengeInput {
  blockchains: CircleBlockchain[];
  accountType?: CircleAccountType;
}

export interface CreateUserTransferChallengeInput {
  walletId: string;
  destinationAddress: string;
  tokenId: string;
  amount: string;
  feeLevel?: CircleFeeLevel;
  refId?: string;
}

export interface UserWalletsClient {
  /** Provision a user (idempotent on `userId`). */
  createUser(userId: string): Promise<{ id: string }>;
  /** Mint a 60-minute user token + SDK encryption key. */
  createUserToken(userId: string): Promise<UserToken>;
  /** Bootstrap challenge: set PIN + create the first wallet(s). */
  initializeUser(userToken: string, input: CreateUserWalletChallengeInput): Promise<UserChallenge>;
  /** Create additional wallet(s) for an initialized user. */
  createWalletChallenge(userToken: string, input: CreateUserWalletChallengeInput): Promise<UserChallenge>;
  /** Create a transfer challenge the user completes with their PIN. */
  createTransferChallenge(userToken: string, input: CreateUserTransferChallengeInput): Promise<UserChallenge>;
  /** Read the user's state by token. */
  getUser(userToken: string): Promise<Record<string, unknown>>;
  /** List the user's wallets by token. */
  listWallets(userToken: string): Promise<CircleWalletResource[]>;
  /** Read a user wallet's token balances. */
  getWalletBalance(userToken: string, walletId: string): Promise<CircleTokenBalance[]>;
  /** Read a user transaction (e.g. after a completed transfer challenge). */
  getTransaction(userToken: string, id: string): Promise<CircleTransactionResource>;
}

export interface UserWalletsClientConfig {
  apiKey: string;
  baseUrl?: string;
  http?: WalletsHttp;
  fetchImpl?: typeof fetch;
  /** Generates idempotency keys (UUIDv4). Required for the mutating calls. */
  idempotencyKey?: () => string;
}

const USER_HEADER = "X-User-Token";

export function createUserWalletsClient(config: UserWalletsClientConfig): UserWalletsClient {
  const http =
    config.http ??
    createFetchWalletsHttp({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? DEFAULT_W3S_BASE_URL,
      ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
    });
  const newIdempotencyKey = config.idempotencyKey ?? defaultIdempotencyKey;

  /** Perform a request, assert 2xx, and unwrap the `{ data }` envelope. */
  async function send<T>(req: WalletsRequest): Promise<T> {
    const res = await http.request(req);
    assertOk(res, req);
    return unwrapData<T>(res.body, req);
  }

  function userHeaders(userToken: string): Record<string, string> {
    requireString(userToken, "userToken");
    return { [USER_HEADER]: userToken };
  }

  return {
    async createUser(userId) {
      requireString(userId, "createUser.userId");
      const req: WalletsRequest = { method: "POST", path: "/v1/w3s/users", body: { userId } };
      const res = await http.request(req);
      assertOk(res, req);
      // The create-user response echoes nothing sensitive; surface the id.
      return { id: userId };
    },

    createUserToken(userId) {
      requireString(userId, "createUserToken.userId");
      return send<UserToken>({ method: "POST", path: "/v1/w3s/users/token", body: { userId } });
    },

    initializeUser(userToken, input) {
      return send<UserChallenge>({
        method: "POST",
        path: "/v1/w3s/user/initialize",
        headers: userHeaders(userToken),
        body: {
          idempotencyKey: newIdempotencyKey(),
          blockchains: input.blockchains,
          ...(input.accountType ? { accountType: input.accountType } : {}),
        },
      });
    },

    createWalletChallenge(userToken, input) {
      return send<UserChallenge>({
        method: "POST",
        path: "/v1/w3s/user/wallets",
        headers: userHeaders(userToken),
        body: {
          idempotencyKey: newIdempotencyKey(),
          blockchains: input.blockchains,
          ...(input.accountType ? { accountType: input.accountType } : {}),
        },
      });
    },

    createTransferChallenge(userToken, input) {
      requireString(input.walletId, "createTransferChallenge.walletId");
      requireString(input.destinationAddress, "createTransferChallenge.destinationAddress");
      requireString(input.tokenId, "createTransferChallenge.tokenId");
      requireString(input.amount, "createTransferChallenge.amount");
      return send<UserChallenge>({
        method: "POST",
        path: "/v1/w3s/user/transactions/transfer",
        headers: userHeaders(userToken),
        body: {
          idempotencyKey: newIdempotencyKey(),
          walletId: input.walletId,
          destinationAddress: input.destinationAddress,
          tokenId: input.tokenId,
          amounts: [input.amount],
          feeLevel: input.feeLevel ?? "MEDIUM",
          ...(input.refId ? { refId: input.refId } : {}),
        },
      });
    },

    getUser(userToken) {
      return send<Record<string, unknown>>({
        method: "GET",
        path: "/v1/w3s/user",
        headers: userHeaders(userToken),
      });
    },

    async listWallets(userToken) {
      const data = await send<{ wallets?: CircleWalletResource[] }>({
        method: "GET",
        path: "/v1/w3s/wallets",
        headers: userHeaders(userToken),
      });
      return data.wallets ?? [];
    },

    async getWalletBalance(userToken, walletId) {
      requireString(walletId, "getWalletBalance.walletId");
      const data = await send<{ tokenBalances?: CircleTokenBalance[] }>({
        method: "GET",
        path: `/v1/w3s/wallets/${encodeURIComponent(walletId)}/balances`,
        headers: userHeaders(userToken),
      });
      return data.tokenBalances ?? [];
    },

    async getTransaction(userToken, id) {
      requireString(id, "getTransaction.id");
      const data = await send<{ transaction?: CircleTransactionResource }>({
        method: "GET",
        path: `/v1/w3s/transactions/${encodeURIComponent(id)}`,
        headers: userHeaders(userToken),
      });
      if (!data.transaction) {
        throw new SettleKitError({
          code: "integration_error",
          message: "Circle user transaction response missing transaction",
        });
      }
      return data.transaction;
    },
  };
}

function defaultIdempotencyKey(): string {
  // Node 18+ exposes crypto.randomUUID globally.
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  throw new SettleKitError({
    code: "integration_error",
    message: "crypto.randomUUID unavailable; provide idempotencyKey in the client config",
  });
}

function requireString(value: unknown, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new SettleKitError({ code: "validation_error", message: `${field} is required` });
  }
}
