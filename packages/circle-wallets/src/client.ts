/**
 * Circle Web3 Services (W3S) **developer-controlled wallets** client.
 *
 * Wraps the real W3S REST endpoints behind a typed client, reusing the
 * injected-transport + `{ data }`-envelope conventions from `@settlekit/circle`.
 * Pure request building / response parsing is decoupled from I/O via the
 * `WalletsHttp` seam, so it is fully unit-testable with an in-memory transport.
 *
 * Endpoints (base `https://api.circle.com`, sandbox `https://api-sandbox.circle.com`):
 *   - POST /v1/w3s/developer/walletSets            create a wallet set
 *   - POST /v1/w3s/developer/wallets               create wallets
 *   - GET  /v1/w3s/wallets                         list wallets
 *   - GET  /v1/w3s/wallets/{id}/balances           get wallet token balances
 *   - POST /v1/w3s/developer/transactions/transfer create a transfer transaction
 *   - POST /v1/w3s/developer/transactions/contractExecution execute a contract call
 *   - GET  /v1/w3s/transactions/{id}               get transaction status
 *
 * ENTITY SECRET (read this): every mutating call requires an
 * `entitySecretCiphertext` — a base64 RSA-encrypted ciphertext of your
 * registered entity secret that Circle requires to be **unique per request**.
 * This package deliberately does NOT store, derive, or encrypt the entity
 * secret. Callers either pass `entitySecretCiphertext` on each mutating call,
 * or supply an `entitySecretProvider` at construction time that returns a fresh
 * ciphertext per request. Use one or the other — see `EntitySecretInput`.
 *
 * Source: https://developers.circle.com/w3s
 */
import { SettleKitError } from "@settlekit/common";
import { createFetchWalletsHttp } from "./http.js";
import type { WalletsHttp, WalletsRequest } from "./http.js";
import { assertOk, requireString, unwrapData } from "./envelope.js";
import { buildContractExecutionRequest } from "./contract-execution.js";
import type { CreateContractExecutionInput } from "./contract-execution.js";
import type {
  CircleAccountType,
  CircleBlockchain,
  CircleFeeLevel,
  CircleTokenBalance,
  CircleTransactionResource,
  CircleWalletResource,
  CircleWalletSet,
} from "./types.js";

export const DEFAULT_W3S_BASE_URL = "https://api.circle.com";
export const SANDBOX_W3S_BASE_URL = "https://api-sandbox.circle.com";

/**
 * Provides a fresh entity-secret ciphertext per mutating request. Circle
 * requires the ciphertext to be unique each call, so a provider is invoked once
 * per mutation. May be async (e.g. to call out to a KMS / signing service).
 */
export type EntitySecretProvider = () => string | Promise<string>;

export interface WalletsClientConfig {
  apiKey: string;
  /** Defaults to the production base URL. */
  baseUrl?: string;
  /** Inject a custom transport (defaults to a real fetch-based impl). */
  http?: WalletsHttp;
  /** Inject a custom fetch (only used when `http` is not provided). */
  fetchImpl?: typeof fetch;
  /**
   * Optional provider returning a fresh entity-secret ciphertext per mutating
   * request. When omitted, callers MUST pass `entitySecretCiphertext` on each
   * mutating call.
   */
  entitySecretProvider?: EntitySecretProvider;
}

/**
 * Per-call entity secret. Provide `entitySecretCiphertext` explicitly, or rely
 * on the client's `entitySecretProvider`. Exactly one source must resolve to a
 * non-empty ciphertext or the call throws a `validation_error`.
 */
export interface EntitySecretInput {
  /** A fresh base64 RSA-encrypted entity-secret ciphertext for this request. */
  entitySecretCiphertext?: string;
}

export interface CreateWalletSetInput extends EntitySecretInput {
  name?: string;
  /** Idempotency key (UUID v4 recommended) forwarded to Circle. */
  idempotencyKey?: string;
}

export interface CreateWalletsInput extends EntitySecretInput {
  walletSetId: string;
  blockchains: CircleBlockchain[];
  /** Number of wallets to create per blockchain. Defaults to 1. */
  count?: number;
  /** EOA (default) or SCA (smart-contract account, gas-abstraction capable). */
  accountType?: CircleAccountType;
  idempotencyKey?: string;
}

export interface ListWalletsInput {
  walletSetId?: string;
  blockchain?: CircleBlockchain;
  address?: string;
  refId?: string;
  pageSize?: number;
  pageBefore?: string;
  pageAfter?: string;
}

export interface CreateTransferInput extends EntitySecretInput {
  /** Source developer-controlled wallet. */
  walletId: string;
  /** Destination on-chain address. */
  destinationAddress: string;
  /**
   * Circle token id of the asset to transfer (e.g. the USDC token id on the
   * wallet's chain). Resolve via wallet balances or Circle's token catalog.
   */
  tokenId: string;
  /**
   * Decimal major-unit amount as a string, e.g. "25.5". A single amount; Circle
   * accepts an array, but a USDC transfer always moves one fungible amount.
   */
  amount: string;
  /** Gas fee level. Defaults to MEDIUM. */
  feeLevel?: CircleFeeLevel;
  /** Caller reference echoed back on the transaction. */
  refId?: string;
  idempotencyKey?: string;
}

export interface WalletsClient {
  createWalletSet(input?: CreateWalletSetInput): Promise<CircleWalletSet>;
  createWallets(input: CreateWalletsInput): Promise<CircleWalletResource[]>;
  listWallets(input?: ListWalletsInput): Promise<CircleWalletResource[]>;
  getWalletBalance(walletId: string): Promise<CircleTokenBalance[]>;
  createTransfer(input: CreateTransferInput): Promise<CircleTransactionResource>;
  createContractExecution(
    input: CreateContractExecutionInput,
  ): Promise<CircleTransactionResource>;
  getTransaction(id: string): Promise<CircleTransactionResource>;
}

export function createWalletsClient(config: WalletsClientConfig): WalletsClient {
  if (!config.apiKey) {
    throw new SettleKitError({
      code: "validation_error",
      message: "createWalletsClient requires an apiKey",
    });
  }
  const baseUrl = config.baseUrl ?? DEFAULT_W3S_BASE_URL;
  const http =
    config.http ??
    createFetchWalletsHttp({ apiKey: config.apiKey, baseUrl, fetchImpl: config.fetchImpl });

  async function send<T>(req: WalletsRequest): Promise<T> {
    const res = await http.request(req);
    assertOk(res, req);
    return unwrapData<T>(res.body, req);
  }

  /** Resolve the per-request entity-secret ciphertext from input or provider. */
  async function resolveEntitySecret(input: EntitySecretInput, op: string): Promise<string> {
    if (input.entitySecretCiphertext && input.entitySecretCiphertext.length > 0) {
      return input.entitySecretCiphertext;
    }
    if (config.entitySecretProvider) {
      const ciphertext = await config.entitySecretProvider();
      if (typeof ciphertext === "string" && ciphertext.length > 0) return ciphertext;
    }
    throw new SettleKitError({
      code: "validation_error",
      message:
        `${op} requires an entitySecretCiphertext (pass it per call or configure ` +
        `entitySecretProvider). Circle requires a fresh ciphertext per request.`,
    });
  }

  return {
    async createWalletSet(input: CreateWalletSetInput = {}): Promise<CircleWalletSet> {
      const entitySecretCiphertext = await resolveEntitySecret(input, "createWalletSet");
      return send<CircleWalletSet>({
        method: "POST",
        path: "/v1/w3s/developer/walletSets",
        body: {
          idempotencyKey: input.idempotencyKey,
          name: input.name,
          entitySecretCiphertext,
        },
      });
    },

    async createWallets(input: CreateWalletsInput): Promise<CircleWalletResource[]> {
      requireString(input.walletSetId, "createWallets.walletSetId");
      if (!Array.isArray(input.blockchains) || input.blockchains.length === 0) {
        throw new SettleKitError({
          code: "validation_error",
          message: "createWallets requires at least one blockchain",
        });
      }
      const entitySecretCiphertext = await resolveEntitySecret(input, "createWallets");
      const data = await send<{ wallets: CircleWalletResource[] }>({
        method: "POST",
        path: "/v1/w3s/developer/wallets",
        body: {
          idempotencyKey: input.idempotencyKey,
          walletSetId: input.walletSetId,
          blockchains: input.blockchains,
          count: input.count ?? 1,
          accountType: input.accountType,
          entitySecretCiphertext,
        },
      });
      return data.wallets;
    },

    async listWallets(input: ListWalletsInput = {}): Promise<CircleWalletResource[]> {
      const data = await send<{ wallets: CircleWalletResource[] }>({
        method: "GET",
        path: "/v1/w3s/wallets",
        query: {
          walletSetId: input.walletSetId,
          blockchain: input.blockchain,
          address: input.address,
          refId: input.refId,
          pageSize: input.pageSize !== undefined ? String(input.pageSize) : undefined,
          pageBefore: input.pageBefore,
          pageAfter: input.pageAfter,
        },
      });
      return data.wallets;
    },

    async getWalletBalance(walletId: string): Promise<CircleTokenBalance[]> {
      requireString(walletId, "getWalletBalance.walletId");
      const data = await send<{ tokenBalances: CircleTokenBalance[] }>({
        method: "GET",
        path: `/v1/w3s/wallets/${encodeURIComponent(walletId)}/balances`,
      });
      return data.tokenBalances;
    },

    async createTransfer(input: CreateTransferInput): Promise<CircleTransactionResource> {
      requireString(input.walletId, "createTransfer.walletId");
      requireString(input.destinationAddress, "createTransfer.destinationAddress");
      requireString(input.tokenId, "createTransfer.tokenId");
      requireString(input.amount, "createTransfer.amount");
      const entitySecretCiphertext = await resolveEntitySecret(input, "createTransfer");
      return send<CircleTransactionResource>({
        method: "POST",
        path: "/v1/w3s/developer/transactions/transfer",
        body: {
          idempotencyKey: input.idempotencyKey,
          walletId: input.walletId,
          destinationAddress: input.destinationAddress,
          tokenId: input.tokenId,
          amounts: [input.amount],
          feeLevel: input.feeLevel ?? "MEDIUM",
          refId: input.refId,
          entitySecretCiphertext,
        },
      });
    },

    async createContractExecution(
      input: CreateContractExecutionInput,
    ): Promise<CircleTransactionResource> {
      requireString(input.walletAddress, "createContractExecution.walletAddress");
      requireString(input.blockchain, "createContractExecution.blockchain");
      requireString(input.contractAddress, "createContractExecution.contractAddress");
      requireString(input.abiFunctionSignature, "createContractExecution.abiFunctionSignature");
      if (!Array.isArray(input.abiParameters)) {
        throw new SettleKitError({
          code: "validation_error",
          message: "createContractExecution requires abiParameters to be an array",
        });
      }
      const entitySecretCiphertext = await resolveEntitySecret(input, "createContractExecution");
      return send<CircleTransactionResource>(
        buildContractExecutionRequest(input, entitySecretCiphertext),
      );
    },

    async getTransaction(id: string): Promise<CircleTransactionResource> {
      requireString(id, "getTransaction.id");
      const data = await send<{ transaction: CircleTransactionResource }>({
        method: "GET",
        path: `/v1/w3s/transactions/${encodeURIComponent(id)}`,
      });
      return data.transaction;
    },
  };
}
