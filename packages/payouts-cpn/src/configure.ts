/**
 * One factory to select the off-ramp backend. A deployment (or an individual
 * module) picks CPN or local without changing calling code — both satisfy
 * {@link OffRampProvider}. Mirrors settlement-core's configureSettlement().
 */

import { CpnOffRampProvider, type CpnProviderConfig } from "./cpn-provider.js";
import { LocalOffRampProvider } from "./local-provider.js";
import type { OffRampProvider, PayoutStore } from "./types.js";

export type OffRampConfig =
  | { provider: "local"; store?: PayoutStore; clock?: () => Date }
  | { provider: "cpn"; config: CpnProviderConfig };

/** Build the configured {@link OffRampProvider}. */
export function configureOffRamp(config: OffRampConfig): OffRampProvider {
  switch (config.provider) {
    case "local":
      return new LocalOffRampProvider({
        ...(config.store !== undefined ? { store: config.store } : {}),
        ...(config.clock !== undefined ? { clock: config.clock } : {}),
      });
    case "cpn":
      return new CpnOffRampProvider(config.config);
  }
}
