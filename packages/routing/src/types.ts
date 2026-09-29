/**
 * Provider-neutral route types shared by the Relay and LI.FI clients.
 */

import type { PaymentNetwork, RouteProviderName } from "@settlekit/common";

export type { RouteProviderName } from "@settlekit/common";

/** How a chain's transactions are executed by the buyer's wallet. */
export type RouteVm = "evm" | "svm" | "hypercore";

/** Where a route must deliver funds for a SettleKit payment network. */
export interface RouteDestination {
  network: PaymentNetwork;
  /** Relay chain id (Relay uses 792703809 for Solana, 1337 for HyperCore). */
  chainId: number;
  /** Token address / SPL mint Relay delivers. */
  token: string;
  symbol: string;
  /** Decimals of `token` at the provider (HyperCore perps USDC is 8). */
  decimals: number;
  vm: RouteVm;
  /** LI.FI chain id + token, or null when LI.FI cannot deliver it safely. */
  lifi: { chainId: number; token: string } | null;
}

/** A token the buyer can pay with. */
export interface RouteOrigin {
  chainId: number;
  token: string;
}

export interface RouteQuoteRequest {
  destination: RouteDestination;
  /** Exact amount owed, in the SESSION's 6-decimal base units. */
  amountBase: bigint;
  /** Merchant payTo on the destination network. */
  recipient: string;
  origin: RouteOrigin;
  /** Buyer's wallet on the origin chain (also the refund address). */
  user: string;
  refundTo: string;
  /** Relay deposit-address mode: the buyer sends funds to an address instead of calldata. */
  depositAddress: boolean;
  /** Optional integrator fee charged on top of the route. */
  appFee?: { recipient: string; bps: number };
  /** Maximum slippage the buyer accepts on the origin side. */
  slippageBps?: number;
}

export interface RouteAmount {
  chainId: number;
  token: string;
  symbol: string;
  decimals: number;
  /** Base units. */
  amount: string;
  /** Guaranteed minimum (destination) / maximum spent (origin), base units. */
  minimumAmount: string;
  amountUsd: string | null;
}

/** An EVM transaction the buyer's wallet must send. */
export interface EvmTxRequest {
  vm: "evm";
  chainId: number;
  from: string;
  to: string;
  data: string;
  /** Wei, decimal string. */
  value: string;
  gas?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

/** A provider payload the checkout cannot execute in-wallet (use deposit mode). */
export interface OpaqueTxRequest {
  vm: "other";
  chainId: number | null;
  raw: unknown;
}

export interface RouteStep {
  id: string;
  kind: "transaction" | "signature";
  description: string;
  items: Array<{ status: "complete" | "incomplete"; tx: EvmTxRequest | OpaqueTxRequest }>;
}

export interface RouteFees {
  /** Everything the buyer pays over the destination amount, in USD (route + app fees). */
  totalUsd: string | null;
  relayerUsd: string | null;
  appUsd: string | null;
  /** Origin-chain gas, paid by the buyer's wallet separately. */
  gasUsd: string | null;
}

export interface RouteQuote {
  provider: RouteProviderName;
  requestId: string;
  origin: RouteAmount;
  destination: RouteAmount;
  recipient: string;
  fees: RouteFees;
  /** Route cost as basis points of the destination amount, null when unpriced. */
  feeBps: number | null;
  /** Slippage tolerance the provider applied, when reported. */
  slippageBps: number | null;
  steps: RouteStep[];
  /** Relay deposit-address mode: send exactly `origin.amount` of the origin token here. */
  depositAddress?: string;
  timeEstimateSec: number | null;
}

/** Normalized provider status. `success` is NOT payment: verify the destination. */
export type RouteStatusState = "waiting" | "pending" | "success" | "refund" | "failure" | "unknown";

export interface RouteStatus {
  provider: RouteProviderName;
  state: RouteStatusState;
  originTxHashes: string[];
  /** Destination fill(s) on success. */
  destinationTxHashes: string[];
  /** Refund transaction(s) on the origin chain. */
  refundTxHashes: string[];
  originChainId: number | null;
  destinationChainId: number | null;
  detail: string | null;
  /** Unix ms, when reported. */
  updatedAt: number | null;
}

export interface RouteStatusQuery {
  requestId: string;
  originChainId: number;
  destinationChainId: number;
  /** LI.FI tracks by the origin transaction. */
  originTxHash?: string;
}

/** A route provider (Relay, LI.FI). */
export interface RouteProvider {
  readonly name: RouteProviderName;
  /** Whether this provider can deliver to `destination` from `origin`. */
  supports(destination: RouteDestination, origin: RouteOrigin, depositAddress: boolean): boolean;
  quote(request: RouteQuoteRequest): Promise<RouteQuote>;
  status(query: RouteStatusQuery): Promise<RouteStatus>;
}
