/**
 * Public configuration types for the live viem ERC-8183 adapter.
 *
 * All viem types are imported with `import type` to satisfy
 * `verbatimModuleSyntax` (type-only symbols must never emit a runtime import).
 */

import type { Abi, Account, PublicClient, WalletClient } from "viem";
import type { DEFAULT_ERC8183_ABI } from "./abi.js";

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
  /** Deployed ERC-8183 job contract address. */
  contractAddress: Hex;
  /**
   * Override ABI. Defaults to {@link DEFAULT_ERC8183_ABI} (assumed — see abi.ts).
   * Supply the real deployed ABI here to use this adapter without a code change.
   */
  abi?: typeof DEFAULT_ERC8183_ABI | Abi;
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
