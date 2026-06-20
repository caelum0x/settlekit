/**
 * Public configuration types for the live viem ERC-8183 adapter.
 *
 * All viem types are imported with `import type` to satisfy
 * `verbatimModuleSyntax` (type-only symbols must never emit a runtime import).
 */

import type { Abi, Account, PublicClient, WalletClient } from "viem";
import type { AGENTIC_COMMERCE_ABI } from "./abi.js";

/** A 0x-prefixed hex string. */
export type Hex = `0x${string}`;

/**
 * Configuration for {@link import("./port.js").createViemErc8183Port}.
 *
 * Exactly one transport strategy must be satisfiable:
 *  - INJECTED clients: provide `walletClient` (with an account) AND
 *    `publicClient`; the adapter uses them verbatim (no `http()` is created),
 *    which is what the no-network tests rely on; OR
 *  - BUILT clients: provide `rpcUrl` plus a signer (`account` OR `privateKey`)
 *    and a `chainId` (the Arc Testnet chainId is the 0 sentinel and must be
 *    overridden — see {@link import("./chain.js").defineArcChain}); the adapter
 *    builds public/wallet clients lazily.
 *
 * Never hardcode a private key. Read it from config or the environment via
 * {@link import("./account.js").readPrivateKeyFromEnv}.
 */
export interface ViemErc8183Config {
  /**
   * Deployed AgenticCommerce (ERC-8183) job contract address. OPTIONAL —
   * defaults to {@link import("./abi.js").DEFAULT_AGENTIC_COMMERCE_ADDRESS}.
   */
  contractAddress?: Hex;
  /**
   * USDC token address used for the `approve` before `fund`. OPTIONAL —
   * defaults to {@link import("./abi.js").DEFAULT_USDC_ADDRESS}.
   */
  usdcAddress?: Hex;
  /**
   * Override ABI. Defaults to the REAL deployed
   * {@link import("./abi.js").AGENTIC_COMMERCE_ABI}. Supply a different ABI here
   * only if the deployed contract diverges.
   */
  abi?: typeof AGENTIC_COMMERCE_ABI | Abi;
  /**
   * Evaluator address for {@link import("./port.js").createViemErc8183Port}'s
   * `createJob`. The fixed `Erc8183Port.createJob` shape has no evaluator
   * parameter, so it is supplied here. Defaults to the requester address
   * (the requester self-evaluates) when omitted.
   */
  evaluator?: Hex;
  /**
   * On-chain job expiry, as a unix-seconds timestamp. The fixed
   * `Erc8183Port.createJob` shape has no expiry parameter, so it is supplied
   * here. REQUIRED in practice (no implicit Date.now() default — library code
   * must stay deterministic); omitting it uses `0` (no expiry sentinel).
   */
  expiredAt?: bigint | number;
  /**
   * Hook contract address for the AgenticCommerce default path. Defaults to the
   * zero address (no hook) when omitted.
   */
  hook?: Hex;
  /** JSON-RPC endpoint used when clients are built (not when injected). */
  rpcUrl?: string;
  /**
   * EVM chain id. REQUIRED when building clients because Arc Testnet's id is the
   * 0 sentinel in `@settlekit/arc-chains` (unpublished); signing for chain 0
   * would produce signatures for the wrong chain.
   */
  chainId?: number;
  /** 0x private key — turned into an account via `privateKeyToAccount`. */
  privateKey?: Hex;
  /** A pre-built viem account (preferred over `privateKey` when both given). */
  account?: Account;
  /** Pre-built wallet client (must carry an account). Used verbatim if given. */
  walletClient?: WalletClient;
  /** Pre-built public client. Used verbatim if given. */
  publicClient?: PublicClient;
}
