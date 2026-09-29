/**
 * The per-network on-chain verifier registry.
 *
 * One {@link SettlementVerifier} per ENABLED network: every EVM chain from
 * `config.evm` (Arc included), Solana when SOLANA_CLUSTER is set, Zcash
 * when ZCASH_ENABLED and HyperCore when HYPERCORE_ENABLED. A network without an entry fails closed — a tx hash
 * alone can never confirm a payment on it.
 */

import { ARC_TESTNET, type FullEvmRpc } from "@settlekit/arc";
import {
  createChainRpc,
  createEvmSettlementVerifier,
  createEvmVerifier,
  createZcashSettlementVerifier,
  type EvmChainKey,
  type EvmChainRuntimeConfig,
  type EvmVerifier,
  type SettlementVerifier,
  type ZcashConfig,
} from "@settlekit/chains";
import { toBaseUnits, type PaymentNetwork } from "@settlekit/common";
import { createHyperCoreClient, createHyperCoreSettlementVerifier, type HyperliquidTransport } from "@settlekit/hyperliquid";
import {
  createKitSolanaRpc,
  createSolanaPaymentVerifier,
  isSolanaSignature,
  verifySplTransfer,
  type SolanaRpc,
} from "@settlekit/solana";
import {
  createBlockchairExplorer,
  createCoinbaseSource,
  createKrakenSource,
  type FetchLike,
  type PriceSource,
  type ZcashExplorer,
  type ZcashNetwork,
} from "@settlekit/zcash";
import type { PaymentVerifier } from "@settlekit/x402";
import type { ApiConfig } from "./env.js";

/** Per-network verifier registry (absent network = fail closed). */
export type PaymentVerifiers = Readonly<Partial<Record<PaymentNetwork, SettlementVerifier>>>;

/** Zcash services used at checkout creation (quote lock) and verification. */
export interface ZcashRuntime {
  network: ZcashNetwork;
  explorer: ZcashExplorer;
  /** Primary first (Coinbase), then fallbacks/cross-checks (Kraken). */
  priceSources: readonly PriceSource[];
  quoteTtlSec: number;
  minConfirmations: number;
}

export interface VerifierRegistry {
  verifiers: PaymentVerifiers;
  /** The raw EVM verifiers, for the boot-time chain-id assertion. */
  evmVerifiers: readonly EvmVerifier[];
  /** x402 view of the Arc verifier (the x402 routes settle on Arc). */
  arcVerifier: PaymentVerifier | null;
  zcash: ZcashRuntime | null;
}

export interface VerifierRegistryDeps {
  /** Inject RPCs per chain (tests); defaults to viem over the configured URL. */
  evmRpcs?: Partial<Record<EvmChainKey, FullEvmRpc>>;
  /** Inject the Solana RPC (tests); defaults to @solana/kit over the configured URL. */
  solanaRpc?: SolanaRpc;
  /** fetch used by Zcash price sources and the explorer. */
  fetch?: FetchLike;
  /** Hyperliquid API transport (tests inject recorded ledgers). */
  hypercoreTransport?: HyperliquidTransport;
}

function buildEvm(chain: EvmChainRuntimeConfig, rpc: FullEvmRpc): { primary: EvmVerifier; settlement: SettlementVerifier } {
  const primary = createEvmVerifier({
    spec: chain.spec,
    rpc,
    minConfirmations: chain.minConfirmations,
    tokenAddress: chain.tokenAddress,
  });
  // Arc also settles EURC / USYC (x402 calls): same rules, their own contracts.
  const extra: Record<string, EvmVerifier> =
    chain.key === "arc"
      ? {
          EURC: createEvmVerifier({ spec: chain.spec, rpc, minConfirmations: chain.minConfirmations, tokenAddress: ARC_TESTNET.tokens.EURC.address }),
          USYC: createEvmVerifier({ spec: chain.spec, rpc, minConfirmations: chain.minConfirmations, tokenAddress: ARC_TESTNET.tokens.USYC.address }),
        }
      : {};
  return { primary, settlement: createEvmSettlementVerifier(primary, extra) };
}

/** Allowed skew between session creation and a routed Solana fill's block time (matches checkout/worker). */
export const ROUTED_FILL_SKEW_MS = 120_000;

/**
 * A route provider's Solana fill carries no Solana Pay reference, so it is
 * bound by payTo, mint, amount and block time (>= session creation - skew).
 */
async function verifyRoutedSolanaFill(
  rpc: SolanaRpc,
  mint: string,
  proof: { txHash: string },
  requirements: { payTo: string; amount: string; notBefore?: string },
): Promise<{ ok: boolean; reason?: string; retryable?: boolean }> {
  if (!isSolanaSignature(proof.txHash)) return { ok: false, reason: "Malformed Solana transaction signature" };
  const notBefore = requirements.notBefore ? new Date(requirements.notBefore).getTime() : Number.NaN;
  if (Number.isNaN(notBefore)) return { ok: false, reason: "routed fill needs the session creation time" };
  const result = await verifySplTransfer(rpc, {
    signature: proof.txHash,
    mint,
    recipientOwner: requirements.payTo,
    minAmount: toBaseUnits(requirements.amount),
    commitment: "confirmed",
  });
  if (!result.ok) return { ok: false, reason: result.message, ...(result.reason === "not_found" ? { retryable: true } : {}) };
  if (result.blockTime === null) return { ok: false, reason: "fill has no block time yet", retryable: true };
  if (result.blockTime * 1000 < notBefore - ROUTED_FILL_SKEW_MS) return { ok: false, reason: "fill predates the checkout session" };
  return { ok: true };
}

/** Adapt the x402-shaped Solana verifier to the settlement contract. */
function solanaVerifier(config: NonNullable<ApiConfig["solana"]>, rpc?: SolanaRpc): SettlementVerifier {
  const solanaRpc = rpc ?? createKitSolanaRpc(config.rpcUrl);
  const verify = createSolanaPaymentVerifier({
    rpc: solanaRpc,
    mint: config.usdcMint,
    commitment: "confirmed",
  });
  return async (proof, requirements) => {
    if (proof.network !== "solana" || requirements.network !== "solana") {
      return { ok: false, reason: `Unsupported network: ${proof.network}` };
    }
    if (requirements.routedFill === true) return verifyRoutedSolanaFill(solanaRpc, config.usdcMint, proof, requirements);
    return verify(
      { ...proof, network: "solana" },
      { ...requirements, scheme: "x402", network: "solana", asset: requirements.asset as "USDC" },
    );
  };
}

function zcashRuntime(config: ZcashConfig, fetchImpl: FetchLike): ZcashRuntime {
  return {
    network: config.network,
    explorer: createBlockchairExplorer({
      fetch: fetchImpl,
      baseUrl: config.explorerUrl,
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    }),
    priceSources: [createCoinbaseSource(fetchImpl), createKrakenSource(fetchImpl)],
    quoteTtlSec: config.quoteTtlSec,
    minConfirmations: config.minConfirmations,
  };
}

/** Build every enabled network's verifier from `config`. */
export function buildVerifierRegistry(config: ApiConfig, deps: VerifierRegistryDeps = {}): VerifierRegistry {
  const verifiers: Partial<Record<PaymentNetwork, SettlementVerifier>> = {};
  const evmVerifiers: EvmVerifier[] = [];
  for (const chain of Object.values(config.evm.enabled)) {
    if (chain === undefined) continue;
    const rpc = deps.evmRpcs?.[chain.key] ?? createChainRpc(chain.spec, chain.rpcUrl);
    const built = buildEvm(chain, rpc);
    evmVerifiers.push(built.primary);
    verifiers[chain.key] = built.settlement;
  }
  if (config.solana) verifiers.solana = solanaVerifier(config.solana, deps.solanaRpc);

  const zcash = config.zcash ? zcashRuntime(config.zcash, deps.fetch ?? (globalThis.fetch as FetchLike)) : null;
  if (zcash) {
    verifiers.zcash = createZcashSettlementVerifier({ explorer: zcash.explorer, minConfirmations: zcash.minConfirmations });
  }

  if (config.hypercore) {
    const client = createHyperCoreClient(config.hypercore, deps.hypercoreTransport ? { transport: deps.hypercoreTransport } : {});
    verifiers.hypercore = createHyperCoreSettlementVerifier(client);
  }

  return { verifiers, evmVerifiers, arcVerifier: verifiers.arc ?? null, zcash };
}
