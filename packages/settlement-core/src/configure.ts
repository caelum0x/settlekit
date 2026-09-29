/**
 * One factory to select the settlement backend. "Both, configurable": a
 * deployment (or an individual module) picks Gateway, Circle, or local without
 * changing any calling code — they all satisfy {@link SettlementProvider}.
 *
 * Providers that live in packages depending on this one (e.g.
 * `@settlekit/solana`'s SolanaSettlementProvider) are passed in pre-built via
 * `{ provider: "injected" }`, which avoids a package dependency cycle.
 */

import { CircleSettlementProvider, type CircleProviderConfig } from "./circle-provider.js";
import { GatewaySettlementProvider, type GatewayTransferPort } from "./gateway-provider.js";
import { LocalSettlementProvider } from "./local-provider.js";
import type { IdempotencyStore, SettlementProvider } from "./types.js";

export type SettlementConfig =
  | { provider: "local"; idempotency?: IdempotencyStore }
  | { provider: "circle"; config: CircleProviderConfig }
  | { provider: "gateway"; port: GatewayTransferPort; idempotency?: IdempotencyStore }
  | { provider: "injected"; instance: SettlementProvider };

/** Build the configured {@link SettlementProvider}. */
export function configureSettlement(config: SettlementConfig): SettlementProvider {
  switch (config.provider) {
    case "local":
      return new LocalSettlementProvider(config.idempotency);
    case "circle":
      return new CircleSettlementProvider(config.config);
    case "gateway":
      return new GatewaySettlementProvider(config.port, config.idempotency);
    case "injected":
      return config.instance;
  }
}
