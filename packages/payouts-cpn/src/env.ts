/**
 * Select an off-ramp backend from environment configuration, so a deployment
 * flips from the local provider to real CPN off-ramp without code changes:
 *
 *   PAYOUTS_OFFRAMP_PROVIDER=cpn
 *   CIRCLE_CPN_API_KEY=...
 *   CIRCLE_CPN_BASE_URL=https://api-sandbox.circle.com   # optional
 *
 * Falls back to the local provider whenever the provider isn't "cpn" or the
 * credentials are missing/empty — mirrors settlementProviderFromEnv.
 */

import { CpnOffRampProvider } from "./cpn-provider.js";
import { createCpnHttpClient } from "./http-client.js";
import { LocalOffRampProvider } from "./local-provider.js";
import type { OffRampProvider } from "./types.js";

/** A minimal env bag (avoids a hard dependency on Node's process types). */
export type EnvLike = Record<string, string | undefined>;

const DEFAULT_CPN_BASE_URL = "https://api.circle.com";

/**
 * Build the off-ramp provider described by `env`. Returns a
 * {@link CpnOffRampProvider} (wired with a live fetch-based http client) when
 * `PAYOUTS_OFFRAMP_PROVIDER=cpn` and `CIRCLE_CPN_API_KEY` is present and
 * non-empty; otherwise a {@link LocalOffRampProvider}.
 */
export function offRampProviderFromEnv(env: EnvLike): OffRampProvider {
  if (env["PAYOUTS_OFFRAMP_PROVIDER"] === "cpn") {
    const apiKey = env["CIRCLE_CPN_API_KEY"];
    if (apiKey !== undefined && apiKey.length > 0) {
      const baseUrlRaw = env["CIRCLE_CPN_BASE_URL"];
      const baseUrl = baseUrlRaw !== undefined && baseUrlRaw.length > 0 ? baseUrlRaw : DEFAULT_CPN_BASE_URL;
      const credentials = { apiKey, baseUrl };
      const http = createCpnHttpClient({ credentials });
      return new CpnOffRampProvider({ credentials, http });
    }
  }
  return new LocalOffRampProvider();
}
