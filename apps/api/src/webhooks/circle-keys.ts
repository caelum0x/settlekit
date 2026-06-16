/**
 * Resolver for Circle's notification signature public keys.
 *
 * Circle signs each webhook with a rotating EC key identified by `X-Circle-Key-Id`.
 * The public key is fetched (and cached) from
 * `GET {base}/v2/notifications/publicKey/{keyId}` using the Circle API key.
 */
import { SettleKitError } from "@settlekit/common";

export interface CirclePublicKeyResolver {
  /** Return the base64 SPKI public key for a Circle key id (cached). */
  getPublicKey(keyId: string): Promise<string>;
}

export interface CirclePublicKeyResolverConfig {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function createCirclePublicKeyResolver(
  config: CirclePublicKeyResolverConfig,
): CirclePublicKeyResolver {
  const base = (config.baseUrl ?? "https://api.circle.com").replace(/\/+$/, "");
  const doFetch = config.fetchImpl ?? globalThis.fetch;
  const cache = new Map<string, string>();

  return {
    async getPublicKey(keyId: string): Promise<string> {
      const cached = cache.get(keyId);
      if (cached) return cached;

      const res = await doFetch(
        `${base}/v2/notifications/publicKey/${encodeURIComponent(keyId)}`,
        { headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" } },
      );
      if (!res.ok) {
        throw new SettleKitError({
          code: "integration_error",
          message: `Circle public-key fetch failed (status ${res.status})`,
          httpStatus: 502,
          details: { keyId, status: res.status },
        });
      }
      const body = (await res.json()) as { data?: { publicKey?: unknown } };
      const publicKey = body?.data?.publicKey;
      if (typeof publicKey !== "string" || publicKey.length === 0) {
        throw new SettleKitError({
          code: "integration_error",
          message: "Circle public-key response missing data.publicKey",
          httpStatus: 502,
          details: { keyId },
        });
      }
      cache.set(keyId, publicKey);
      return publicKey;
    },
  };
}
