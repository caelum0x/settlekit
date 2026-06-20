/**
 * Thin convenience factory mirroring `@settlekit/erc8183`'s `configureErc8183`:
 * build the live viem port and wrap it in a ready-to-use {@link JobClient}, so
 * consumers get a chain-backed client in one call.
 */

import { configureErc8183, type JobClient } from "@settlekit/erc8183";
import { createViemErc8183Port } from "./port.js";
import type { ViemErc8183Config } from "./types.js";

/**
 * Build a {@link JobClient} backed by the live viem ERC-8183 adapter.
 *
 * @example
 * const jobs = configureViemErc8183({
 *   contractAddress: "0x...",
 *   rpcUrl: "https://rpc.testnet.arc.network/",
 *   chainId: 1234, // Arc Testnet id (override the 0 sentinel)
 *   privateKey: readPrivateKeyFromEnv(process.env),
 * });
 */
export function configureViemErc8183(config: ViemErc8183Config): JobClient {
  return configureErc8183({ port: createViemErc8183Port(config) });
}
