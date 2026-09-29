/**
 * The facilitator's `/supported` document (x402 v2 `SupportedResponse`):
 * one `exact` kind per enabled network plus the relayer signer addresses,
 * and a SettleKit asset listing for status pages.
 */
import type { Network, SupportedResponse } from "@x402/core/types";
import type { FacilitatorAsset } from "./assets.js";

/** The upstream `x402Facilitator.getSupported()` shape (network as plain string). */
export interface UpstreamSupported {
  kinds: Array<{ x402Version: number; scheme: string; network: string; extra?: Record<string, unknown> }>;
  extensions: string[];
  signers: Record<string, string[]>;
}

/** Keep only v2 `exact` kinds for enabled networks from the upstream document. */
export function buildSupported(
  upstream: UpstreamSupported,
  assets: ReadonlyMap<string, FacilitatorAsset>,
): SupportedResponse {
  const kinds = upstream.kinds
    .filter((kind) => kind.x402Version === 2 && kind.scheme === "exact" && assets.has(kind.network))
    .map((kind) => ({ ...kind, network: kind.network as Network }));
  return { kinds, extensions: [...upstream.extensions], signers: { ...upstream.signers } };
}

export interface AssetDescription {
  network: string;
  caip2: string;
  env: string;
  symbol: string;
  address: string;
  decimals: number;
  transferMethod: string;
  eip712?: { name: string; version: string };
  experimental: boolean;
  note?: string;
}

/** Human/agent-readable description of every enabled asset. */
export function describeAssets(assets: readonly FacilitatorAsset[]): AssetDescription[] {
  return assets.map((asset) => ({
    network: asset.network,
    caip2: asset.caip2,
    env: asset.env,
    symbol: asset.symbol,
    address: asset.address,
    decimals: asset.decimals,
    transferMethod: asset.transferMethod,
    ...(asset.eip712 ? { eip712: asset.eip712 } : {}),
    experimental: asset.experimental,
    ...(asset.note ? { note: asset.note } : {}),
  }));
}
