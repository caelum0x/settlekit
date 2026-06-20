/**
 * The minimal Circle App Kit surface this package depends on — a *port* the
 * consumer injects (dependency inversion, like settlement-core's providers).
 *
 * A real `new AppKit()` from `@circle-fin/app-kit` satisfies this shape; tests
 * and demos use {@link LocalAppKitSdk}. Keeping the contract here means this
 * package never imports the SDK and so adds no external dependency.
 *
 * `A` is the opaque signing adapter (viem/ethers/solana/circle-wallets).
 */

/** Raw transfer result returned by every App Kit capability. */
export interface SdkResult {
  /** SDK operation name, e.g. "transfer", "bridge", "swap". */
  name?: string;
  /** SDK state, e.g. "success", "pending", "failed". */
  state?: string;
  /** On-chain transaction hash. */
  txHash?: string;
  /** Block-explorer URL. */
  explorerUrl?: string;
}

/** Raw send estimate. */
export interface SdkEstimate {
  gas?: string;
  fee?: string;
  gasPrice?: string;
}

/** App Kit `send`/`estimateSend` parameters. */
export interface SdkSendParams<A> {
  from: { adapter: A; chain: string; address?: string };
  to: string;
  amount: string;
  token: string;
}

/** App Kit `bridge` parameters. */
export interface SdkBridgeParams<A> {
  from: { adapter: A; chain: string };
  to: { adapter: A; chain: string };
  amount: string;
}

/** App Kit `swap` parameters. */
export interface SdkSwapParams<A> {
  from: { adapter: A; chain: string };
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  config?: { kitKey?: string };
}

/** App Kit `unifiedBalance.deposit` parameters. */
export interface SdkDepositParams<A> {
  from: { adapter: A; chain: string };
  amount: string;
  token: string;
}

/** App Kit `unifiedBalance.spend` parameters. */
export interface SdkSpendParams<A> {
  from: { adapter: A };
  amountIn: string;
  to: { adapter: A; chain: string; recipientAddress: string };
}

/** The Unified Balance sub-API. */
export interface UnifiedBalanceSdk<A> {
  deposit(params: SdkDepositParams<A>): Promise<SdkResult>;
  spend(params: SdkSpendParams<A>): Promise<SdkResult>;
}

/** The injected App Kit client contract. */
export interface AppKitSdk<A> {
  send(params: SdkSendParams<A>): Promise<SdkResult>;
  estimateSend?(params: SdkSendParams<A>): Promise<SdkEstimate>;
  bridge(params: SdkBridgeParams<A>): Promise<SdkResult>;
  swap(params: SdkSwapParams<A>): Promise<SdkResult>;
  unifiedBalance: UnifiedBalanceSdk<A>;
}
