/**
 * @settlekit/app-kit-viem — a viem-only {@link AppKitSdk} implementing the SEND
 * capability (a USDC ERC-20 transfer) on Arc, so `ArcSettlementProvider` can
 * settle real USDC with `viem` alone (no `@circle-fin` SDK).
 *
 * SCOPE / CAVEAT (loud): only `send`/`estimateSend` work. `bridge`, `swap`, and
 * `unifiedBalance.deposit`/`spend` THROW `SettleKitError` — they require
 * Circle's cross-chain infrastructure. Use `@circle-fin/app-kit` for those.
 *
 * Addresses are never invented: arc-chains leaves the Arc USDC address
 * `undefined` and the Arc chainId as the `0` sentinel, so a deployment MUST
 * inject `config.tokenAddressOverrides` (and `config.chainId`) until they are
 * published. The signer key comes from `config.privateKey` or env
 * (`SETTLEKIT_PRIVATE_KEY`) — never hardcoded.
 */

export { createViemAppKitSdk } from "./viem-sdk.js";

export {
  resolveAccount,
  resolveWallet,
  DEFAULT_PRIVATE_KEY_ENV,
} from "./account.js";
export type {
  ViemAppKitConfig,
  InjectedWallet,
  ResolvedWallet,
} from "./account.js";

export { toViemChain } from "./chain.js";
export type { NativeCurrencyConfig } from "./chain.js";

export {
  resolveChain,
  resolveDecimals,
  resolveToken,
  resolveUsdcAddress,
} from "./resolve.js";
export type { TokenAddressOverrides } from "./resolve.js";

export { checksumAddress, encodeTransfer, toBaseUnits } from "./encode.js";

export { ERC20_TRANSFER_ABI } from "./abi.js";

export { notSupported, UNSUPPORTED_MESSAGE_SUFFIX } from "./unsupported.js";

// Live App Kit signer adapters via Circle's official @circle-fin/adapter-viem-v2
// (dynamic-imported; pair with @circle-fin/app-kit for a true on-chain send).
export {
  createCircleViemAdapterFromPrivateKey,
  createCircleViemAdapterFromProvider,
} from "./circle-adapter.js";
export type { CircleViemAdapter } from "./circle-adapter.js";
