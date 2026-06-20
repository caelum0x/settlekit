/**
 * Account / wallet resolution + config defaulting.
 *
 * Account resolution from an injected client/account is PURE (unit-tested). The
 * private-key path turns a 0x key (from config or env, NEVER hardcoded) into an
 * Account via `privateKeyToAccount`; only the `send`/`estimateSend` paths build
 * the wallet/public clients (which need an `http` transport), so pure-helper
 * tests never construct a transport.
 *
 * Keys are read from `config.privateKey` or an injected env object
 * (`config.env`, default `process.env`) under `config.privateKeyEnv`
 * (default `SETTLEKIT_PRIVATE_KEY`). The key is never written to source.
 */

import { createPublicClient, createWalletClient, http } from "viem";
import type { Account, Chain, Hex, PublicClient, WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SettleKitError } from "@settlekit/common";
import type { NativeCurrencyConfig } from "./chain.js";
import type { TokenAddressOverrides } from "./resolve.js";

/** Default env var the private key is read from when not passed in config. */
export const DEFAULT_PRIVATE_KEY_ENV = "SETTLEKIT_PRIVATE_KEY";

/** A pre-built viem wallet handle the caller injects directly. */
export interface InjectedWallet {
  account: Account;
  walletClient: WalletClient;
  publicClient: PublicClient;
}

/** A resolved trio ready for contract writes / reads. */
export interface ResolvedWallet {
  account: Account;
  walletClient: WalletClient;
  publicClient: PublicClient;
}

/**
 * Configuration for the viem App Kit backend.
 *
 * Provide EITHER an injected `wallet` (a, fully-built trio) OR a private key
 * source (`privateKey` or env). The key path also needs `rpcUrl`+`chain` to
 * build clients lazily.
 */
export interface ViemAppKitConfig {
  /** Pre-built viem clients + account. Takes precedence over the key path. */
  wallet?: InjectedWallet;
  /** 0x private key. Prefer the env path; never hardcode in source. */
  privateKey?: Hex;
  /** Env var name to read the private key from. Default SETTLEKIT_PRIVATE_KEY. */
  privateKeyEnv?: string;
  /** Env source for the key (injectable for tests). Default `process.env`. */
  env?: Record<string, string | undefined>;
  /**
   * RPC url for the key path. Overrides the arc-chains descriptor rpcUrl when
   * the caller wants a private endpoint. Required (here or via descriptor) to
   * build clients on the key path.
   */
  rpcUrl?: string;
  /** Override the chainId (e.g. when arc-chains has the 0 sentinel). */
  chainId?: number;
  /** Override the explorer base url (e.g. when arc-chains leaves it empty). */
  explorerUrl?: string;
  /** Native-currency override for the defined chain (Arc gas display). */
  nativeCurrency?: NativeCurrencyConfig;
  /** Inject real per-chain token addresses arc-chains leaves undefined. */
  tokenAddressOverrides?: TokenAddressOverrides;
}

/**
 * Derive an {@link Account} from `config` without building any client.
 * Pure and unit-tested.
 *
 * @throws {SettleKitError} `validation_error` when no key source is present.
 */
export function resolveAccount(config: ViemAppKitConfig): Account {
  if (config.wallet) {
    return config.wallet.account;
  }

  const env = config.env ?? process.env;
  const envName = config.privateKeyEnv ?? DEFAULT_PRIVATE_KEY_ENV;
  const key = config.privateKey ?? (env[envName] as Hex | undefined);

  if (key === undefined || key.length === 0) {
    throw new SettleKitError({
      code: "validation_error",
      message: `no signer configured — inject config.wallet, set config.privateKey, or provide a 0x key in env.${envName}; the key is never hardcoded`,
    });
  }

  return privateKeyToAccount(key);
}

/**
 * Resolve the full {@link ResolvedWallet}. Returns an injected wallet unchanged;
 * otherwise derives the account from the key and builds wallet/public clients
 * bound to `chain` (this is the only place an `http` transport is created).
 *
 * @throws {SettleKitError} `validation_error` when no signer is configured.
 */
export function resolveWallet(
  config: ViemAppKitConfig,
  chain: Chain,
  rpcUrl: string,
): ResolvedWallet {
  if (config.wallet) {
    return {
      account: config.wallet.account,
      walletClient: config.wallet.walletClient,
      publicClient: config.wallet.publicClient,
    };
  }

  const account = resolveAccount(config);
  const transportUrl = config.rpcUrl ?? rpcUrl;
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(transportUrl),
  });
  const publicClient = createPublicClient({
    chain,
    transport: http(transportUrl),
  });

  return { account, walletClient, publicClient };
}
