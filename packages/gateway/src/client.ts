/**
 * High-level Circle Gateway (Unified Balance) client.
 *
 * Composes the pure encoders, the EIP-712 typed-data builder, the off-chain
 * Gateway API ({@link GatewayApi}), and on-chain balance reads ({@link GatewayRpc})
 * behind one ergonomic surface. I/O is injected, so the client is fully
 * testable; production defaults wire real `fetch` and a viem RPC.
 */

import { SettleKitError } from "@settlekit/common";
import { getAddress } from "viem";
import {
  createFetchGatewayHttp,
  createGatewayApi,
  GATEWAY_API_TESTNET_BASE_URL,
} from "./api.js";
import type { ApiDomainBalance, BalanceSource, GatewayApi, GatewayHttp } from "./api.js";
import {
  readGatewayBalance,
  sumUnifiedAvailable,
} from "./balance.js";
import type { ChainAvailable, GatewayRpc } from "./balance.js";
import { createViemGatewayRpc } from "./balance.js";
import {
  buildBurnIntent,
  buildDepositTxRequest,
  buildGatewayMintTxRequest,
  buildInitiateWithdrawalTxRequest,
  buildWithdrawTxRequest,
} from "./encode.js";
import type { BuildBurnIntentParams } from "./encode.js";
import { burnIntentTypedData } from "./eip712.js";
import type {
  Address,
  BurnIntent,
  GatewayBalance,
  Hex,
  SignedBurnIntent,
  TransferAttestation,
  TxRequest,
} from "./types.js";

/** Configuration for {@link createGatewayClient}. */
export interface GatewayClientConfig {
  /** Gateway API base URL. Defaults to the testnet endpoint. */
  apiBaseUrl?: string;
  /** Optional Gateway API key. */
  apiKey?: string;
  /** JSON-RPC endpoint for on-chain balance reads. Required for balance reads. */
  rpcUrl?: string;
  /** Inject a custom Gateway API transport (defaults to real fetch). */
  http?: GatewayHttp;
  /** Inject a custom fetch (used only when `http` is not provided). */
  fetchImpl?: typeof fetch;
  /** Inject a custom on-chain RPC (defaults to a viem client over `rpcUrl`). */
  rpc?: GatewayRpc;
}

/** Parameters for reading a depositor's balance on one chain. */
export interface ReadChainBalanceParams {
  gatewayWallet: string;
  token: string;
  depositor: string;
}

export interface GatewayClient {
  /** Build a `GatewayWallet.deposit(token, value)` transaction request. */
  buildDeposit(params: { gatewayWallet: string; token: string; value: bigint }): TxRequest;
  /** Build a `GatewayWallet.initiateWithdrawal(token, value)` transaction request. */
  buildInitiateWithdrawal(params: {
    gatewayWallet: string;
    token: string;
    value: bigint;
  }): TxRequest;
  /** Build a `GatewayWallet.withdraw(token)` transaction request. */
  buildWithdraw(params: { gatewayWallet: string; token: string }): TxRequest;
  /** Build an unsigned {@link BurnIntent} for a unified-balance spend. */
  buildBurnIntent(params: BuildBurnIntentParams): BurnIntent;
  /** Produce the EIP-712 typed-data payload for signing a burn intent. */
  burnIntentTypedData(intent: BurnIntent): ReturnType<typeof burnIntentTypedData>;
  /**
   * Request a mint attestation for signed burn intents from the Gateway API.
   */
  requestTransferAttestation(
    intents: SignedBurnIntent[],
    options?: { enableForwarder?: boolean },
  ): Promise<TransferAttestation>;
  /**
   * Build a `GatewayMinter.gatewayMint(attestation, signature)` transaction
   * request from a Gateway API attestation.
   */
  buildGatewayMint(params: {
    gatewayMinter: string;
    attestation: Hex;
    signature: Hex;
  }): TxRequest;
  /** Read a depositor's full balance breakdown on one chain (on-chain). */
  readChainBalance(params: ReadChainBalanceParams): Promise<GatewayBalance>;
  /** Read available unified balances per domain from the Gateway API. */
  getApiBalances(token: string, sources: BalanceSource[]): Promise<ApiDomainBalance[]>;
  /** Sum per-chain available balances into one unified spendable total (pure). */
  unifiedAvailable(perChain: ChainAvailable[]): bigint;
  readonly api: GatewayApi;
}

/** Create a Gateway client. I/O seams may be injected for testing. */
export function createGatewayClient(config: GatewayClientConfig = {}): GatewayClient {
  const baseUrl = config.apiBaseUrl ?? GATEWAY_API_TESTNET_BASE_URL;
  const http =
    config.http ??
    createFetchGatewayHttp({
      baseUrl,
      apiKey: config.apiKey,
      fetchImpl: config.fetchImpl,
    });
  const api = createGatewayApi(http);

  let cachedRpc = config.rpc;
  function resolveRpc(): GatewayRpc {
    if (cachedRpc) return cachedRpc;
    if (!config.rpcUrl) {
      throw new SettleKitError({
        code: "validation_error",
        message: "Gateway: on-chain balance reads require a configured rpcUrl or injected rpc",
      });
    }
    cachedRpc = createViemGatewayRpc({ rpcUrl: config.rpcUrl });
    return cachedRpc;
  }

  function toAddress(value: string, field: string): Address {
    try {
      return getAddress(value);
    } catch {
      throw new SettleKitError({
        code: "validation_error",
        message: `Gateway: ${field} must be a valid EVM address`,
      });
    }
  }

  return {
    api,
    buildDeposit: (params) => buildDepositTxRequest(params),
    buildInitiateWithdrawal: (params) => buildInitiateWithdrawalTxRequest(params),
    buildWithdraw: (params) => buildWithdrawTxRequest(params),
    buildBurnIntent: (params) => buildBurnIntent(params),
    burnIntentTypedData: (intent) => burnIntentTypedData(intent),
    requestTransferAttestation: (intents, options) =>
      api.requestTransferAttestation(intents, options),
    buildGatewayMint: (params) => buildGatewayMintTxRequest(params),
    getApiBalances: (token, sources) => api.getBalances(token, sources),
    unifiedAvailable: (perChain) => sumUnifiedAvailable(perChain),

    async readChainBalance(params: ReadChainBalanceParams): Promise<GatewayBalance> {
      const rpc = resolveRpc();
      return readGatewayBalance(rpc, {
        gatewayWallet: toAddress(params.gatewayWallet, "gatewayWallet"),
        token: toAddress(params.token, "token"),
        depositor: toAddress(params.depositor, "depositor"),
      });
    },
  };
}
