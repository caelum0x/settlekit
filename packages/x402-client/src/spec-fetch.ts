/**
 * Agent-side x402 v2 payer: wraps `fetch` so a 402 challenge from any
 * spec-compliant server (SettleKit included) is paid automatically with the
 * x402-foundation client schemes (`@x402/evm` EIP-3009 / Permit2 signing,
 * `@x402/svm` partially-signed SPL transfer), then retried.
 *
 * Spend controls are always on: the x402 client only pays assets it
 * recognizes, so SettleKit's registry tokens (HyperEVM USDC, Robinhood USDG,
 * Tempo USDC.e, ...) are opted in explicitly with an atomic per-payment cap,
 * and a selector prefers the caller's networks in order.
 */
import { x402Client, type SpendControlAsset } from "@x402/core/client";
import { decodePaymentResponseHeader } from "@x402/core/http";
import type { Network, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { wrapFetchWithPayment } from "@x402/fetch";
import type { ClientEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { getUsdcAddress } from "@x402/svm";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import type { TransactionSigner } from "@solana/kit";
import { EVM_CHAINS, SOLANA_CAIP2, type ChainEnv } from "@settlekit/chains";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface SpecPayerOptions {
  /** Base fetch (defaults to globalThis.fetch). */
  fetch?: typeof globalThis.fetch;
  /** EVM account that signs EIP-3009 / Permit2 authorizations (e.g. viem privateKeyToAccount). */
  evmSigner?: ClientEvmSigner;
  /** Solana signer (e.g. @solana/kit createKeyPairSignerFromBytes). */
  svmSigner?: TransactionSigner;
  /** Solana RPC used to build the transfer (defaults to the public cluster RPC). */
  svmRpcUrl?: string;
  /** Registry environment whose tokens are opted in (default mainnet). */
  env?: ChainEnv;
  /** Atomic per-payment cap (6 decimals) for every opted-in token. Default 5 USD. */
  maxAtomicPerPayment?: string;
  /** Pay on the first of these CAIP-2 networks the server offers. */
  preferNetworks?: readonly string[];
}

const DEFAULT_MAX_ATOMIC = "5000000";

/**
 * Every stablecoin SettleKit settles in on `env`, as x402 spend-control
 * opt-ins: registry EVM tokens plus Circle USDC on Solana.
 */
export function settleKitAllowedAssets(env: ChainEnv, maxAtomicPerPayment: string = DEFAULT_MAX_ATOMIC): SpendControlAsset[] {
  const evm = Object.values(EVM_CHAINS[env])
    .filter((spec) => spec !== undefined)
    .map((spec) => ({ network: spec.caip2 as Network, asset: spec.token.address, maxAmountPerPayment: maxAtomicPerPayment }));
  const solanaNetwork = SOLANA_CAIP2[env] as Network;
  return [...evm, { network: solanaNetwork, asset: getUsdcAddress(solanaNetwork), maxAmountPerPayment: maxAtomicPerPayment }];
}

/** Pick the first requirement on a preferred network, else the first offered. */
export function preferNetworksSelector(preferred: readonly string[]) {
  return (_version: number, requirements: PaymentRequirements[]): PaymentRequirements => {
    for (const network of preferred) {
      const match = requirements.find((requirement) => requirement.network === network);
      if (match) return match;
    }
    const first = requirements[0];
    if (!first) throw new Error("server offered no payment requirements");
    return first;
  };
}

/** Build the x402 client with SettleKit spend controls and signers registered. */
export function createSpecX402Client(options: SpecPayerOptions): x402Client {
  if (!options.evmSigner && !options.svmSigner) {
    throw new Error("createSpecX402Client needs an evmSigner and/or an svmSigner");
  }
  const env = options.env ?? "mainnet";
  const allowed = settleKitAllowedAssets(env, options.maxAtomicPerPayment ?? DEFAULT_MAX_ATOMIC);
  const client = new x402Client(
    options.preferNetworks && options.preferNetworks.length > 0 ? preferNetworksSelector(options.preferNetworks) : undefined,
  );
  client.setSpendControls({ maxAmountPerPayment: false, allowedAssets: allowed });
  if (options.evmSigner) client.register("eip155:*", new ExactEvmScheme(options.evmSigner));
  if (options.svmSigner) {
    const svm = new ExactSvmScheme(options.svmSigner, options.svmRpcUrl ? { rpcUrl: options.svmRpcUrl } : undefined);
    for (const caip2 of Object.values(SOLANA_CAIP2)) client.register(caip2 as Network, svm);
  }
  return client;
}

/** A fetch that pays x402 v2 challenges automatically. */
export function createSpecX402Fetch(options: SpecPayerOptions): FetchLike {
  const base = options.fetch ?? globalThis.fetch;
  return wrapFetchWithPayment(base, createSpecX402Client(options));
}

/** Decode the PAYMENT-RESPONSE settlement receipt from a paid response, if any. */
export function readPaymentResponse(response: Response): SettleResponse | null {
  const header = response.headers.get("PAYMENT-RESPONSE") ?? response.headers.get("X-PAYMENT-RESPONSE");
  return header ? decodePaymentResponseHeader(header) : null;
}
