/**
 * SettleKit's self-hosted x402 facilitator.
 *
 * Verification and settlement are delegated to the x402-foundation
 * `exact` EVM scheme (EIP-3009 `transferWithAuthorization`, or Permit2 via
 * the x402 Permit2 proxy), wrapped with SettleKit policy:
 *   - per-network enable list (experimental assets need an explicit opt-in)
 *   - kill switch (refuses verify + settle immediately)
 *   - registry-pinned asset + EIP-712 domain, optional recipient allowlist
 *   - max atomic amount per settlement
 *   - nonce replay protection before any gas is spent
 *   - gas budget guard (per-settlement cap, rolling daily cap, balance floor)
 */
import { x402Facilitator } from "@x402/core/facilitator";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import type { FacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import type { ChainEnv, EvmChainKey } from "@settlekit/chains";
import { getFacilitatorAsset, type FacilitatorAsset } from "./assets.js";
import type { GasGuard } from "./gas-guard.js";
import { InMemoryNonceStore, nonceKey, type NonceStore } from "./nonce-store.js";
import { REASONS, checkPolicy, type CheckedPayment, type PolicyConfig } from "./policy.js";
import { buildSupported } from "./supported.js";

export interface SettleKitFacilitatorConfig {
  env: ChainEnv;
  /** Networks this facilitator relays for. */
  enabledNetworks: readonly EvmChainKey[];
  /** Required to enable experimental assets (Tempo Permit2, Robinhood testnet). */
  allowExperimental?: boolean;
  /** The relayer signer per CAIP-2 network. */
  signerFor: (caip2: string) => FacilitatorEvmSigner | undefined;
  gasGuard: GasGuard;
  /** Max atomic amount per settlement: one value for all networks or per CAIP-2. */
  maxAmountPerSettlement: bigint | Readonly<Record<string, bigint>>;
  /** Optional recipient allowlist (merchant payTo addresses). */
  allowedPayTo?: readonly string[];
  nonceStore?: NonceStore;
  /** Kill switch; checked on every call so it can be flipped at runtime. */
  killSwitch?: () => boolean;
  /** Re-simulate the transfer during settle (default true: never pay gas for a revert). */
  simulateInSettle?: boolean;
}

/** The facilitator surface (matches x402 `FacilitatorClient`). */
export interface SettleKitFacilitator {
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse>;
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse>;
  getSupported(): Promise<SupportedResponse>;
  /** Enabled assets, for status pages and route configuration. */
  assets(): FacilitatorAsset[];
  killed(): boolean;
}

export class FacilitatorConfigError extends Error {
  override readonly name = "FacilitatorConfigError";
}

function resolveAssets(config: SettleKitFacilitatorConfig): Map<string, FacilitatorAsset> {
  const assets = new Map<string, FacilitatorAsset>();
  for (const network of config.enabledNetworks) {
    const asset = getFacilitatorAsset(network, config.env);
    if (!asset) {
      throw new FacilitatorConfigError(`no settleable asset for ${network} on ${config.env}`);
    }
    if (asset.experimental && !config.allowExperimental) {
      throw new FacilitatorConfigError(
        `${network} (${asset.symbol}) on ${config.env} is experimental; set allowExperimental to enable it`,
      );
    }
    if (!config.signerFor(asset.caip2)) {
      throw new FacilitatorConfigError(`no relayer signer for ${asset.caip2}`);
    }
    assets.set(asset.caip2, asset);
  }
  return assets;
}

function maxAmountResolver(limit: SettleKitFacilitatorConfig["maxAmountPerSettlement"]): (caip2: string) => bigint {
  if (typeof limit === "bigint") return () => limit;
  return (caip2) => limit[caip2] ?? 0n;
}

function settleFailure(
  requirements: PaymentRequirements,
  errorReason: string,
  errorMessage: string,
  payer?: string,
): SettleResponse {
  return {
    success: false,
    errorReason,
    errorMessage,
    transaction: "",
    network: requirements.network,
    ...(payer ? { payer } : {}),
  };
}

/** Build the facilitator. Throws {@link FacilitatorConfigError} on a bad config. */
export function createSettleKitFacilitator(config: SettleKitFacilitatorConfig): SettleKitFacilitator {
  const assets = resolveAssets(config);
  const nonces = config.nonceStore ?? new InMemoryNonceStore();
  const killed = config.killSwitch ?? (() => false);
  const policy: PolicyConfig = {
    assets,
    maxAmountFor: maxAmountResolver(config.maxAmountPerSettlement),
    allowedPayTo: new Set((config.allowedPayTo ?? []).map((address) => address.toLowerCase())),
    killed,
  };

  const upstream = new x402Facilitator();
  for (const asset of assets.values()) {
    const signer = config.signerFor(asset.caip2) as FacilitatorEvmSigner;
    upstream.register(asset.caip2, new ExactEvmScheme(signer, { simulateInSettle: config.simulateInSettle ?? true }));
  }

  const keyFor = (payment: CheckedPayment) =>
    nonceKey({ caip2: payment.asset.caip2, asset: payment.asset.address, from: payment.from, nonce: payment.nonce });

  async function verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    const checked = checkPolicy(policy, payload, requirements);
    if (!checked.ok) {
      return { isValid: false, invalidReason: checked.reason, invalidMessage: checked.message, ...(checked.payer ? { payer: checked.payer } : {}) };
    }
    const existing = await nonces.get(keyFor(checked.payment));
    if (existing) {
      return {
        isValid: false,
        invalidReason: REASONS.nonceUsed,
        invalidMessage: `authorization nonce is already ${existing.state}`,
        payer: checked.payment.from,
      };
    }
    return upstream.verify(payload, requirements);
  }

  async function settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    const checked = checkPolicy(policy, payload, requirements);
    if (!checked.ok) return settleFailure(requirements, checked.reason, checked.message, checked.payer);
    const payment = checked.payment;
    const key = keyFor(payment);

    const existing = await nonces.get(key);
    if (existing && existing.state !== "broadcast") {
      return settleFailure(requirements, REASONS.nonceUsed, `authorization nonce is already ${existing.state}`, payment.from);
    }
    // A previously broadcast, unconfirmed settlement of THIS payload: let the
    // upstream scheme reconcile against the sent transaction (no new gas).
    const reconciling = existing?.state === "broadcast";

    let estimatedFee = 0n;
    if (!reconciling) {
      const gas = await config.gasGuard.check(payment.asset.caip2, payment.method);
      if (!gas.ok) return settleFailure(requirements, gas.reason, gas.message, payment.from);
      estimatedFee = gas.estimatedFee;
      if (!(await nonces.reserve(key))) {
        return settleFailure(requirements, REASONS.nonceUsed, "authorization nonce is already in flight", payment.from);
      }
    }

    let result: SettleResponse;
    try {
      result = await upstream.settle(payload, requirements);
    } catch (error) {
      if (!reconciling) await nonces.release(key);
      const message = error instanceof Error ? error.message : String(error);
      return settleFailure(requirements, REASONS.settleFailed, message, payment.from);
    }

    if (result.success) {
      await nonces.markSettled(key, result.transaction);
    } else if (result.transaction) {
      await nonces.markBroadcast(key, result.transaction);
    } else if (!reconciling) {
      await nonces.release(key);
    }
    if (!reconciling && result.transaction) config.gasGuard.record(payment.asset.caip2, estimatedFee);
    return result;
  }

  return {
    verify,
    settle,
    getSupported: async () => buildSupported(upstream.getSupported(), assets),
    assets: () => [...assets.values()],
    killed,
  };
}
