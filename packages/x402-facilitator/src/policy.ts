/**
 * SettleKit policy checks run BEFORE the x402 exact EVM scheme sees a
 * payment. The upstream scheme verifies the signature, recipient, time
 * window, exact value and simulates the transfer, but it trusts the
 * requirements it is handed. These checks pin the requirements to what this
 * facilitator is willing to relay: an enabled network, the registry token and
 * its verified EIP-712 domain, an allowed recipient and a bounded amount.
 */
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { AssetTransferMethod, FacilitatorAsset } from "./assets.js";

export const REASONS = {
  disabled: "facilitator_disabled",
  scheme: "unsupported_scheme",
  networkNotEnabled: "network_not_enabled",
  networkMismatch: "network_mismatch",
  assetNotAllowed: "asset_not_allowed",
  transferMethod: "transfer_method_not_supported",
  domainMismatch: "eip712_domain_mismatch",
  recipientNotAllowed: "recipient_not_allowed",
  amountInvalid: "amount_invalid",
  amountExceedsLimit: "amount_exceeds_limit",
  invalidPayload: "invalid_payload",
  nonceUsed: "nonce_already_used",
  settleFailed: "settle_failed",
} as const;

export type PolicyReason = (typeof REASONS)[keyof typeof REASONS];

export interface PolicyConfig {
  /** Enabled assets keyed by CAIP-2 network. */
  assets: ReadonlyMap<string, FacilitatorAsset>;
  /** Max atomic amount one settlement may move, per CAIP-2 network. */
  maxAmountFor: (caip2: string) => bigint;
  /** Lowercased recipient allowlist; empty means any recipient. */
  allowedPayTo: ReadonlySet<string>;
  /** True while the kill switch is engaged. */
  killed: () => boolean;
}

/** The authorization facts extracted from a validated payment. */
export interface CheckedPayment {
  asset: FacilitatorAsset;
  method: AssetTransferMethod;
  from: string;
  nonce: string;
  value: bigint;
}

export type PolicyResult =
  | { ok: true; payment: CheckedPayment }
  | { ok: false; reason: PolicyReason; message: string; payer?: string };

function fail(reason: PolicyReason, message: string, payer?: string): PolicyResult {
  return { ok: false, reason, message, ...(payer ? { payer } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseAtomic(value: unknown): bigint | undefined {
  const text = str(value);
  if (!text || !/^\d+$/.test(text)) return undefined;
  return BigInt(text);
}

interface Extracted {
  method: AssetTransferMethod;
  from: string;
  nonce: string;
  value: bigint;
  token?: string;
}

/** Pull (method, payer, nonce, value) out of an exact EVM payload. */
export function extractAuthorization(payload: Record<string, unknown>): Extracted | undefined {
  const auth = payload.authorization;
  if (isRecord(auth)) {
    const from = str(auth.from);
    const nonce = str(auth.nonce);
    const value = parseAtomic(auth.value);
    if (!from || !nonce || value === undefined) return undefined;
    return { method: "eip3009", from, nonce, value };
  }
  const permit = payload.permit2Authorization;
  if (isRecord(permit) && isRecord(permit.permitted)) {
    const from = str(permit.from);
    const nonce = str(permit.nonce);
    const value = parseAtomic(permit.permitted.amount);
    const token = str(permit.permitted.token);
    if (!from || !nonce || value === undefined || !token) return undefined;
    return { method: "permit2", from, nonce, value, token };
  }
  return undefined;
}

function same(a: string | undefined, b: string): boolean {
  return a !== undefined && a.toLowerCase() === b.toLowerCase();
}

/** Run every policy check; returns the extracted authorization when all pass. */
export function checkPolicy(
  config: PolicyConfig,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): PolicyResult {
  if (config.killed()) return fail(REASONS.disabled, "the facilitator kill switch is engaged");
  if (requirements.scheme !== "exact" || payload.accepted?.scheme !== "exact") {
    return fail(REASONS.scheme, "only the exact scheme is relayed");
  }
  const asset = config.assets.get(requirements.network);
  if (!asset) return fail(REASONS.networkNotEnabled, `network ${requirements.network} is not enabled`);
  if (payload.accepted.network !== requirements.network) {
    return fail(REASONS.networkMismatch, "payload network differs from the requirements");
  }
  if (!same(requirements.asset, asset.address) || !same(payload.accepted.asset, asset.address)) {
    return fail(REASONS.assetNotAllowed, `asset must be ${asset.symbol} ${asset.address} on ${asset.caip2}`);
  }

  const auth = isRecord(payload.payload) ? extractAuthorization(payload.payload) : undefined;
  if (!auth) return fail(REASONS.invalidPayload, "payload carries no EIP-3009 or Permit2 authorization");
  if (auth.method !== asset.transferMethod) {
    return fail(REASONS.transferMethod, `${asset.symbol} on ${asset.caip2} settles via ${asset.transferMethod}`, auth.from);
  }
  if (auth.method === "eip3009") {
    const extra = requirements.extra ?? {};
    if (extra.name !== asset.eip712?.name || extra.version !== asset.eip712?.version) {
      return fail(REASONS.domainMismatch, "requirements EIP-712 domain does not match the token", auth.from);
    }
  } else if (!same(auth.token, asset.address)) {
    return fail(REASONS.assetNotAllowed, "Permit2 authorization is for a different token", auth.from);
  }

  if (config.allowedPayTo.size > 0 && !config.allowedPayTo.has(requirements.payTo.toLowerCase())) {
    return fail(REASONS.recipientNotAllowed, "recipient is not on the facilitator allowlist", auth.from);
  }

  const required = parseAtomic(requirements.amount);
  if (required === undefined || required === 0n) {
    return fail(REASONS.amountInvalid, "requirements amount must be a positive integer", auth.from);
  }
  const max = config.maxAmountFor(asset.caip2);
  if (required > max || auth.value > max) {
    return fail(REASONS.amountExceedsLimit, `amount exceeds the per-settlement cap ${max}`, auth.from);
  }
  return { ok: true, payment: { asset, method: auth.method, from: auth.from, nonce: auth.nonce, value: auth.value } };
}
