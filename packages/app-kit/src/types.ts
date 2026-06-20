/**
 * SettleKit-facing types for Circle App Kit money movement on Arc.
 *
 * App Kit (`@circle-fin/app-kit`) exposes four capabilities behind one
 * type-safe interface — Send, Bridge, Swap, and Unified Balance — over Circle
 * protocols (Gateway, CCTP). This package wraps that surface in SettleKit
 * idioms: decimal-USDC amounts, schema-validated requests, and `Result`-typed
 * outcomes that never throw across the boundary.
 *
 * The signing adapter (`A`) is intentionally opaque: callers build it from
 * `@circle-fin/adapter-viem-v2`, `@circle-fin/adapter-circle-wallets`, etc. and
 * pass it through. This package never imports the App Kit SDK — the consumer
 * injects a configured client (see {@link configureAppKit}) — so it adds no
 * external dependency and bundles cleanly anywhere.
 */

/** Blockchains App Kit supports for SettleKit flows (Arc-centric). */
export type SupportedChain =
  | "Arc_Testnet"
  | "Arc_Mainnet"
  | "Ethereum_Sepolia"
  | "Ethereum"
  | "Base_Sepolia"
  | "Base"
  | "Arbitrum_Sepolia"
  | "Arbitrum";

/** Runtime allow-list mirroring {@link SupportedChain} for validation. */
export const SUPPORTED_CHAINS: readonly SupportedChain[] = [
  "Arc_Testnet",
  "Arc_Mainnet",
  "Ethereum_Sepolia",
  "Ethereum",
  "Base_Sepolia",
  "Base",
  "Arbitrum_Sepolia",
  "Arbitrum",
];

/** Tokens App Kit can transfer or swap. */
export type SupportedToken = "USDC" | "EURC" | "USDT" | "USDe" | "DAI" | "PYUSD" | "cirBTC";

/** Runtime allow-list mirroring {@link SupportedToken} for validation. */
export const SUPPORTED_TOKENS: readonly SupportedToken[] = [
  "USDC",
  "EURC",
  "USDT",
  "USDe",
  "DAI",
  "PYUSD",
  "cirBTC",
];

/** Which capability produced a result. */
export type TransferKind = "send" | "bridge" | "swap" | "deposit" | "spend";

/** Normalized terminal/interim state of an operation. */
export type TransferStatus = "success" | "pending" | "failed";

/** Normalized outcome of an App Kit operation. */
export interface TransferResult {
  /** The capability that ran. */
  kind: TransferKind;
  /** Status normalized from the SDK's `state`. */
  status: TransferStatus;
  /** On-chain transaction hash, when the SDK returned one. */
  txHash?: string;
  /** Block-explorer URL for {@link txHash}, when available. */
  explorerUrl?: string;
  /** Raw SDK operation name (e.g. "transfer", "bridge"), for audit logs. */
  operation?: string;
}

/** Estimated cost of a send, surfaced before submitting. */
export interface TransferEstimate {
  /** Estimated gas units. */
  gas?: string;
  /** Estimated fee in USDC-denominated gas. */
  fee?: string;
  /** Estimated gas price. */
  gasPrice?: string;
}

/* -------------------------------------------------------------------------- */
/* SettleKit request shapes (adapter `A` is the caller's opaque signer)        */
/* -------------------------------------------------------------------------- */

/** Transfer a token between wallets on one chain. */
export interface SendRequest<A> {
  adapter: A;
  chain: SupportedChain;
  /** Recipient wallet address. */
  to: string;
  /** Decimal amount, e.g. "1.00". */
  amount: string;
  /** Token symbol; defaults to USDC. */
  token?: SupportedToken;
  /** Sender address — required by the Circle Wallets adapter, optional otherwise. */
  address?: string;
}

/** Move USDC across chains (Gateway/CCTP under the hood). */
export interface BridgeRequest<A> {
  adapter: A;
  fromChain: SupportedChain;
  toChain: SupportedChain;
  /** Destination adapter; defaults to {@link BridgeRequest.adapter}. */
  toAdapter?: A;
  /** Decimal USDC amount. */
  amount: string;
}

/** Exchange one token for another on the same chain. */
export interface SwapRequest<A> {
  adapter: A;
  chain: SupportedChain;
  tokenIn: SupportedToken;
  tokenOut: SupportedToken;
  /** Decimal input amount. */
  amountIn: string;
}

/** Deposit a token from one chain into the chain-abstracted Unified Balance. */
export interface DepositRequest<A> {
  adapter: A;
  chain: SupportedChain;
  /** Decimal amount. */
  amount: string;
  /** Token symbol; defaults to USDC. */
  token?: SupportedToken;
}

/** Spend from the Unified Balance to a recipient on a destination chain. */
export interface SpendRequest<A> {
  adapter: A;
  /** Destination adapter; defaults to {@link SpendRequest.adapter}. */
  toAdapter?: A;
  toChain: SupportedChain;
  /** Recipient wallet address on {@link SpendRequest.toChain}. */
  recipientAddress: string;
  /** Decimal USDC amount to spend. */
  amount: string;
}
