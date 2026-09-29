/**
 * Agent payments runtime (x402 v2 on every chain + MPP on Tempo), built once
 * from env at boot and attached to the AppContext.
 *
 * Facilitator routing:
 *   - remote (PayAI by default, no key): Solana, Base, Arbitrum
 *   - local  (@settlekit/x402-facilitator, relayer hot key): Ethereum,
 *     HyperEVM, Robinhood (+ Tempo Permit2 when explicitly enabled)
 * A network is offered only when it has a payTo address and a facilitator.
 *
 *   X402_EVM_PAY_TO / X402_SOLANA_PAY_TO   merchant recipients (X402_PAY_TO_<KEY> per network)
 *   X402_NETWORKS                          networks to offer (default: all routable)
 *   X402_REMOTE_FACILITATOR_URL            default https://facilitator.payai.network
 *   X402_REMOTE_FACILITATOR_API_KEY        optional bearer for a keyed facilitator
 *   X402_REMOTE_NETWORKS                   default solana,base,arbitrum
 *   X402_RESEARCH_PRICE                    sample resource price, USD (default 0.01)
 *   X402_FACILITATOR_TOKEN                 bearer for POST /v1/x402/facilitator/{verify,settle}
 *   X402_ORGANIZATION_ID                   org credited for the sample resource
 *   MPP_SECRET_KEY / MPP_TEMPO_RECIPIENT / MPP_REALM   Tempo MPP (mppx)
 *   plus @settlekit/x402-facilitator env (X402_RELAYER_PRIVATE_KEY, ...),
 *   SETTLEKIT_CHAIN_ENV / <KEY>_NETWORK and SOLANA_CLUSTER.
 */
import type { PaymentNetwork } from "@settlekit/common";
import { DEFAULT_ORG_ID } from "@settlekit/persistence";
import {
  SOLANA_CAIP2,
  checkPayTo,
  getEvmChain,
  isEvmChainKey,
  parseChainEnv,
  readEnv,
  type ChainEnv,
  type Env,
  type EvmChainKey,
} from "@settlekit/chains";
import { parseSolanaCluster, getSolanaCluster } from "@settlekit/solana";
import { PAYAI_FACILITATOR_URL, routeFacilitators, type FacilitatorRoute } from "@settlekit/x402";
import {
  getFacilitatorAsset,
  loadFacilitatorFromEnv,
  requirementsExtraFor,
  type SettleKitFacilitator,
} from "@settlekit/x402-facilitator";
import { HTTPFacilitatorClient, type FacilitatorClient } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { buildMppRuntime, type MppRuntime } from "./mpp.js";

export type FacilitatorKind = "remote" | "local";

/** One network an agent can pay on. */
export interface AgentPaymentNetwork {
  network: PaymentNetwork;
  caip2: Network;
  env: ChainEnv;
  symbol: string;
  /** Token address (EVM) or mint (Solana). */
  asset: string;
  decimals: number;
  payTo: string;
  facilitator: FacilitatorKind;
  /** Requirements `extra` (EIP-712 domain or Permit2 transfer method). */
  extra: Record<string, unknown>;
  experimental: boolean;
}

export interface AgentPaymentsRuntime {
  networks: readonly AgentPaymentNetwork[];
  /** Network-scoped facilitator clients handed to the x402 resource server. */
  facilitators: readonly FacilitatorClient[];
  /** The in-process self-hosted facilitator, when a relayer key is configured. */
  localFacilitator: SettleKitFacilitator | null;
  facilitatorToken?: string;
  /** Sample resource price, decimal USD. */
  researchPrice: string;
  /** Organization credited for the sample resource. */
  organizationId: string;
  maxTimeoutSeconds: number;
  /** Why a configured network is not offered. */
  notes: readonly string[];
  mpp: MppRuntime | null;
}

export const DEFAULT_REMOTE_NETWORKS: readonly PaymentNetwork[] = ["solana", "base", "arbitrum"];
const OFFERABLE: readonly PaymentNetwork[] = ["solana", "base", "arbitrum", "ethereum", "hyperevm", "robinhood", "tempo"];

function chainEnvFor(env: Env, key: EvmChainKey): ChainEnv {
  return (
    parseChainEnv(readEnv(env, `${key.toUpperCase()}_NETWORK`), `${key.toUpperCase()}_NETWORK`) ??
    parseChainEnv(readEnv(env, "SETTLEKIT_CHAIN_ENV"), "SETTLEKIT_CHAIN_ENV") ??
    "testnet"
  );
}

function solanaEnv(env: Env): ChainEnv {
  const cluster = readEnv(env, "SOLANA_CLUSTER");
  if (cluster !== undefined) return parseSolanaCluster(cluster) === "mainnet" ? "mainnet" : "testnet";
  return parseChainEnv(readEnv(env, "SETTLEKIT_CHAIN_ENV"), "SETTLEKIT_CHAIN_ENV") ?? "testnet";
}

function payToFor(env: Env, network: PaymentNetwork): string | undefined {
  const specific = readEnv(env, `X402_PAY_TO_${network.toUpperCase()}`);
  if (specific !== undefined) return specific;
  return network === "solana" ? readEnv(env, "X402_SOLANA_PAY_TO") : readEnv(env, "X402_EVM_PAY_TO");
}

function listEnv(env: Env, key: string, fallback: readonly PaymentNetwork[]): PaymentNetwork[] {
  const raw = readEnv(env, key);
  if (raw === undefined) return [...fallback];
  return raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part): part is PaymentNetwork => (OFFERABLE as readonly string[]).includes(part));
}

/** The remote-facilitated network entry (asset from the registry / Solana cluster). */
function remoteNetwork(env: Env, network: PaymentNetwork, payTo: string): AgentPaymentNetwork | string {
  if (network === "solana") {
    const chainEnv = solanaEnv(env);
    const cluster = getSolanaCluster(chainEnv === "mainnet" ? "mainnet" : "devnet");
    return {
      network,
      caip2: SOLANA_CAIP2[chainEnv] as Network,
      env: chainEnv,
      symbol: "USDC",
      asset: cluster.usdcMint,
      decimals: 6,
      payTo,
      facilitator: "remote",
      extra: {},
      experimental: false,
    };
  }
  if (!isEvmChainKey(network)) return `${network}: not an x402 network`;
  const chainEnv = chainEnvFor(env, network);
  const asset = getFacilitatorAsset(network, chainEnv);
  if (!asset || asset.transferMethod !== "eip3009") return `${network}: no EIP-3009 asset on ${chainEnv}`;
  return {
    network,
    caip2: asset.caip2,
    env: chainEnv,
    symbol: asset.symbol,
    asset: asset.address,
    decimals: asset.decimals,
    payTo,
    facilitator: "remote",
    extra: requirementsExtraFor(asset),
    experimental: false,
  };
}

export interface LoadAgentPaymentsOptions {
  /** Inject the local facilitator (tests); defaults to loading it from env. */
  localFacilitator?: SettleKitFacilitator | null;
}

/** Build the runtime from env, or null when no network can be offered and MPP is off. */
export function loadAgentPayments(env: Env = process.env, options: LoadAgentPaymentsOptions = {}): AgentPaymentsRuntime | null {
  const notes: string[] = [];
  const loaded = options.localFacilitator === undefined ? loadFacilitatorFromEnv(env) : null;
  const local = options.localFacilitator === undefined ? (loaded?.facilitator ?? null) : options.localFacilitator;
  if (loaded) notes.push(...loaded.skipped.map((reason) => `local facilitator skipped ${reason}`));

  const wanted = new Set(listEnv(env, "X402_NETWORKS", OFFERABLE));
  const remoteWanted = listEnv(env, "X402_REMOTE_NETWORKS", DEFAULT_REMOTE_NETWORKS);
  const networks: AgentPaymentNetwork[] = [];

  for (const asset of local?.assets() ?? []) {
    if (!wanted.has(asset.network)) continue;
    const payTo = payToFor(env, asset.network);
    if (payTo === undefined || !checkPayTo(asset.network, payTo).ok) {
      notes.push(`${asset.network}: set a valid X402_EVM_PAY_TO or X402_PAY_TO_${asset.network.toUpperCase()}`);
      continue;
    }
    networks.push({
      network: asset.network,
      caip2: asset.caip2,
      env: asset.env,
      symbol: asset.symbol,
      asset: asset.address,
      decimals: asset.decimals,
      payTo,
      facilitator: "local",
      extra: requirementsExtraFor(asset),
      experimental: asset.experimental,
    });
  }

  for (const network of remoteWanted) {
    if (!wanted.has(network) || networks.some((entry) => entry.network === network)) continue;
    const payTo = payToFor(env, network);
    if (payTo === undefined || !checkPayTo(network, payTo).ok) {
      notes.push(`${network}: set a valid ${network === "solana" ? "X402_SOLANA_PAY_TO" : "X402_EVM_PAY_TO"}`);
      continue;
    }
    const entry = remoteNetwork(env, network, payTo);
    if (typeof entry === "string") notes.push(entry);
    else networks.push(entry);
  }

  const routes: FacilitatorRoute[] = [];
  const remoteNets = networks.filter((entry) => entry.facilitator === "remote").map((entry) => entry.caip2);
  if (remoteNets.length > 0) {
    const apiKey = readEnv(env, "X402_REMOTE_FACILITATOR_API_KEY");
    const client = new HTTPFacilitatorClient({
      url: readEnv(env, "X402_REMOTE_FACILITATOR_URL") ?? PAYAI_FACILITATOR_URL,
      ...(apiKey
        ? {
            createAuthHeaders: async () => {
              const headers = { Authorization: `Bearer ${apiKey}` };
              return { verify: headers, settle: headers, supported: headers };
            },
          }
        : {}),
    });
    routes.push({ name: "remote", client, networks: remoteNets });
  }
  const localNets = networks.filter((entry) => entry.facilitator === "local").map((entry) => entry.caip2);
  if (local && localNets.length > 0) routes.push({ name: "local", client: local, networks: localNets });

  const mpp = buildMppRuntime(env, notes);
  if (networks.length === 0 && mpp === null && local === null) return null;

  const token = readEnv(env, "X402_FACILITATOR_TOKEN");
  return {
    networks,
    facilitators: routeFacilitators(routes),
    localFacilitator: local,
    ...(token ? { facilitatorToken: token } : {}),
    researchPrice: readEnv(env, "X402_RESEARCH_PRICE") ?? "0.01",
    organizationId: readEnv(env, "X402_ORGANIZATION_ID") ?? DEFAULT_ORG_ID,
    maxTimeoutSeconds: 300,
    notes,
    mpp,
  };
}

/** The Tempo registry token for `env` (MPP currency). */
export function tempoToken(chainEnv: ChainEnv): { address: string; symbol: string; decimals: number; chainId: number } | null {
  const spec = getEvmChain("tempo", chainEnv);
  return spec ? { address: spec.token.address, symbol: spec.token.symbol, decimals: spec.token.decimals, chainId: spec.chainId } : null;
}
