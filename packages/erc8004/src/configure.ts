/**
 * One factory to build an {@link AgentRegistryClient}. The consumer injects a
 * configured {@link Erc8004Port}; this package never depends on a chain library.
 *
 * Live wiring (in the consumer, which owns the chain dependency) — the port can
 * be backed by viem or Circle Developer-Controlled Wallets:
 *
 * ```ts
 * import { configureErc8004 } from "@settlekit/erc8004";
 * import { createViemErc8004Port } from "./my-viem-port.js"; // consumer-owned
 *
 * const registry = configureErc8004({ port: createViemErc8004Port({ walletClient, publicClient }) });
 * const res = await registry.registerAgent({ metadataUri: "ipfs://agent.json" });
 * ```
 *
 * Tests and demos inject {@link LocalErc8004Port} instead of a real port.
 * See the README for full viem and Circle DCW port sketches.
 */

import { AgentRegistryClient } from "./client.js";
import type { Erc8004Port } from "./port.js";

/** Options for {@link configureErc8004}. */
export interface ConfigureErc8004Options {
  /** The injected ERC-8004 port implementation. */
  port: Erc8004Port;
}

/** Build a configured {@link AgentRegistryClient}. */
export function configureErc8004(options: ConfigureErc8004Options): AgentRegistryClient {
  return new AgentRegistryClient({ port: options.port });
}
