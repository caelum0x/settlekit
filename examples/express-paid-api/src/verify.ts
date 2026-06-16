/**
 * A real, fetch-based {@link PaymentVerifier} for the x402 middleware.
 *
 * The verifier confirms an inbound {@link PaymentProof} against the SettleKit
 * API. SettleKit (optionally backed by an on-chain settlement provider such as
 * ARC) is the source of truth for whether the advertised transfer actually
 * settled. We POST the proof + the challenge requirements to a configurable
 * verify endpoint and accept the payment only when the API affirmatively
 * confirms it.
 *
 * Honest-by-default: if no verify URL is configured we REJECT every proof. This
 * example never blanket-accepts a payment — an unconfigured deployment is a
 * closed door, not an open one.
 */
import type {
  PaymentProof,
  PaymentRequirements,
  PaymentVerifier,
  VerifyResult,
} from "./x402.js";

/** Shape of the SettleKit success/error envelope: {"data":T} | {"error":{...}}. */
interface SettleKitEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string };
}

/** Payload returned by the x402 payment-verify endpoint. */
interface PaymentVerifyData {
  /** Whether SettleKit confirmed the on-chain settlement for this proof. */
  verified: boolean;
  /** Optional human-readable reason when not verified. */
  reason?: string;
}

/** Options controlling how the verifier reaches the SettleKit API. */
export interface SettleKitVerifierOptions {
  /**
   * Absolute URL of the SettleKit payment-verify endpoint. When omitted (or
   * empty) the verifier rejects every proof instead of accepting blindly.
   *
   * Defaults to `${SETTLEKIT_API_URL}/v1/paid/research/verify` when
   * `SETTLEKIT_API_URL` is set.
   */
  verifyUrl?: string;
  /** Bearer API key for the SettleKit API (`Authorization: Bearer <key>`). */
  apiKey?: string;
  /** Request timeout in milliseconds. Defaults to 10_000. */
  timeoutMs?: number;
  /** Injectable fetch (for testing). Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Derive the default verify URL from `SETTLEKIT_API_URL`, if present. Returns
 * `undefined` when the base URL is not configured so the caller can fall back
 * to honest rejection.
 */
function defaultVerifyUrl(): string | undefined {
  const base = process.env.SETTLEKIT_API_URL?.trim();
  if (base === undefined || base.length === 0) {
    return undefined;
  }
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}/v1/paid/research/verify`;
}

/**
 * Narrow an unknown error into a short, log-safe message.
 */
function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "unknown error";
}

/**
 * Build a {@link PaymentVerifier} that confirms proofs against the SettleKit
 * API. The returned function is the exact `verify` contract the x402 middleware
 * expects: `(proof, requirements) => Promise<VerifyResult>`.
 */
export function createSettleKitVerifier(
  options: SettleKitVerifierOptions = {},
): PaymentVerifier {
  const verifyUrl = options.verifyUrl ?? defaultVerifyUrl();
  const apiKey = options.apiKey ?? process.env.SETTLEKIT_API_KEY;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? globalThis.fetch;

  return async function verify(
    proof: PaymentProof,
    requirements: PaymentRequirements,
  ): Promise<VerifyResult> {
    // Honest rejection: with no configured verify endpoint we cannot confirm a
    // real on-chain settlement, so we refuse rather than grant free access.
    if (verifyUrl === undefined || verifyUrl.length === 0) {
      return {
        ok: false,
        reason:
          "payment verification is not configured (set SETTLEKIT_API_URL or pass verifyUrl)",
      };
    }

    if (typeof doFetch !== "function") {
      return { ok: false, reason: "no fetch implementation available" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (apiKey !== undefined && apiKey.length > 0) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const response = await doFetch(verifyUrl, {
        method: "POST",
        headers,
        // Send both the proof and the exact requirements that were challenged
        // so the API can confirm the transfer matches amount/asset/network/nonce.
        body: JSON.stringify({ proof, requirements }),
        signal: controller.signal,
      });

      // Parse the envelope defensively — never trust the shape blindly.
      let envelope: SettleKitEnvelope<PaymentVerifyData>;
      try {
        envelope = (await response.json()) as SettleKitEnvelope<PaymentVerifyData>;
      } catch {
        return {
          ok: false,
          reason: `verify endpoint returned non-JSON (HTTP ${response.status})`,
        };
      }

      if (!response.ok) {
        const message =
          envelope.error?.message ??
          `verify endpoint returned HTTP ${response.status}`;
        return { ok: false, reason: message };
      }

      const data = envelope.data;
      if (data === undefined || typeof data.verified !== "boolean") {
        return {
          ok: false,
          reason: "verify endpoint returned a malformed envelope",
        };
      }

      if (data.verified !== true) {
        return {
          ok: false,
          reason: data.reason ?? "payment not confirmed by SettleKit",
        };
      }

      return { ok: true };
    } catch (error: unknown) {
      const aborted = error instanceof Error && error.name === "AbortError";
      return {
        ok: false,
        reason: aborted
          ? `verify request timed out after ${timeoutMs}ms`
          : `verify request failed: ${errorMessage(error)}`,
      };
    } finally {
      clearTimeout(timer);
    }
  };
}
