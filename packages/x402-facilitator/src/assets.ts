/**
 * Assets the self-hosted facilitator can settle, per network and environment.
 *
 * Token address, chain id, decimals and CAIP-2 id come ONLY from the
 * `@settlekit/chains` registry. This file adds just the settlement facts the
 * registry does not carry: which x402 asset-transfer method the token supports
 * and, for EIP-3009 tokens, the EIP-712 domain the authorization is signed
 * over. Every domain below was read on-chain (`name()`, `version()`,
 * `DOMAIN_SEPARATOR()`) on 2026-09-29; the golden test recomputes each
 * DOMAIN_SEPARATOR from these values.
 *
 *  - Ethereum USDC        EIP-3009, domain "USD Coin" / "2"
 *  - HyperEVM USDC        EIP-3009, domain "USDC" / "2"
 *  - Robinhood USDG       EIP-3009, domain "Global Dollar" / "1" (`version()` reverts)
 *  - Robinhood testnet    "Mock USDC": no EIP-3009, no EIP-2612 -> Permit2 only (experimental)
 *  - Tempo USDC.e         no EIP-3009 -> Permit2 via the x402 Permit2 proxy (experimental;
 *                         TIP-20 transfer policies can still revert)
 *  - Tempo Moderato       the x402 Permit2 proxy is not deployed -> unsupported
 */
import {
  getEvmChain,
  type ChainEnv,
  type EvmChainKey,
  type EvmChainSpec,
  type Hex,
} from "@settlekit/chains";

/** Canonical Permit2 (Uniswap), deployed at the same address on every supported chain. */
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

/** x402 asset-transfer methods of the `exact` EVM scheme. */
export type AssetTransferMethod = "eip3009" | "permit2";

export interface Eip712TokenDomain {
  name: string;
  version: string;
}

/** A token the facilitator can settle, joined with its registry chain spec. */
export interface FacilitatorAsset {
  network: EvmChainKey;
  env: ChainEnv;
  chainId: number;
  caip2: `eip155:${number}`;
  symbol: string;
  address: Hex;
  decimals: number;
  transferMethod: AssetTransferMethod;
  /** EIP-712 domain for EIP-3009 authorizations (absent for Permit2). */
  eip712?: Eip712TokenDomain;
  /** Experimental paths are never enabled by default. */
  experimental: boolean;
  note?: string;
}

interface SettlementFacts {
  transferMethod: AssetTransferMethod;
  eip712?: Eip712TokenDomain;
  experimental?: boolean;
  note?: string;
}

const USD_COIN_V2: Eip712TokenDomain = { name: "USD Coin", version: "2" };
const USDC_V2: Eip712TokenDomain = { name: "USDC", version: "2" };

const FACTS: Readonly<Record<ChainEnv, Readonly<Partial<Record<EvmChainKey, SettlementFacts>>>>> = {
  mainnet: {
    ethereum: { transferMethod: "eip3009", eip712: USD_COIN_V2 },
    base: { transferMethod: "eip3009", eip712: USD_COIN_V2 },
    arbitrum: { transferMethod: "eip3009", eip712: USD_COIN_V2 },
    hyperevm: { transferMethod: "eip3009", eip712: USDC_V2 },
    robinhood: { transferMethod: "eip3009", eip712: { name: "Global Dollar", version: "1" } },
    tempo: {
      transferMethod: "permit2",
      experimental: true,
      note: "TIP-20 has no EIP-3009; settles through Permit2 + x402 proxy. Relayer gas is paid in a USD fee token.",
    },
  },
  testnet: {
    ethereum: { transferMethod: "eip3009", eip712: USDC_V2 },
    base: { transferMethod: "eip3009", eip712: USDC_V2 },
    arbitrum: { transferMethod: "eip3009", eip712: USD_COIN_V2 },
    hyperevm: { transferMethod: "eip3009", eip712: USDC_V2 },
    robinhood: {
      transferMethod: "permit2",
      experimental: true,
      note: "Testnet Mock USDC implements neither EIP-3009 nor EIP-2612; payers need a one-time Permit2 approval.",
    },
  },
};

function join(spec: EvmChainSpec, facts: SettlementFacts): FacilitatorAsset {
  return {
    network: spec.key,
    env: spec.env,
    chainId: spec.chainId,
    caip2: spec.caip2,
    symbol: spec.token.symbol,
    address: spec.token.address,
    decimals: spec.token.decimals,
    transferMethod: facts.transferMethod,
    ...(facts.eip712 ? { eip712: facts.eip712 } : {}),
    experimental: facts.experimental ?? false,
    ...(facts.note ? { note: facts.note } : {}),
  };
}

/** The settleable asset for `network` on `env`, or undefined when none. */
export function getFacilitatorAsset(network: EvmChainKey, env: ChainEnv): FacilitatorAsset | undefined {
  const facts = FACTS[env][network];
  const spec = getEvmChain(network, env);
  if (!facts || !spec) return undefined;
  return join(spec, facts);
}

/** Every settleable asset on `env`. */
export function listFacilitatorAssets(env: ChainEnv): FacilitatorAsset[] {
  const out: FacilitatorAsset[] = [];
  for (const network of Object.keys(FACTS[env]) as EvmChainKey[]) {
    const asset = getFacilitatorAsset(network, env);
    if (asset) out.push(asset);
  }
  return out;
}

/** Find the asset for a CAIP-2 network id across both environments. */
export function findFacilitatorAssetByCaip2(caip2: string): FacilitatorAsset | undefined {
  for (const env of ["mainnet", "testnet"] as const) {
    const match = listFacilitatorAssets(env).find((asset) => asset.caip2 === caip2);
    if (match) return match;
  }
  return undefined;
}

/**
 * The `extra` block x402 payment requirements must carry for `asset`:
 * the EIP-712 domain for EIP-3009 tokens, `assetTransferMethod` for Permit2.
 */
export function requirementsExtraFor(asset: FacilitatorAsset): Record<string, unknown> {
  if (asset.transferMethod === "permit2") return { assetTransferMethod: "permit2" };
  return { name: asset.eip712?.name, version: asset.eip712?.version };
}

/** Convert a decimal major-unit amount ("0.25") to base units for `decimals`. */
export function toAtomicAmount(amount: string, decimals: number): string {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!match) throw new Error(`invalid decimal amount: ${amount}`);
  const whole = match[1] as string;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new Error(`amount ${amount} has more than ${decimals} decimals`);
  }
  const atomic = BigInt(whole + fraction.padEnd(decimals, "0"));
  return atomic.toString();
}

/** Convert base units back to a decimal major-unit string (trailing zeros trimmed). */
export function fromAtomicAmount(atomic: string | bigint, decimals: number): string {
  const value = BigInt(atomic);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}
