/**
 * Thin convenience factory mirroring `@settlekit/erc8183`'s `configureErc8183`
 * and `@settlekit/erc8183-viem`'s `configureViemErc8183`: build the DCW port and
 * wrap it in a ready-to-use {@link JobClient}, so consumers get a chain-backed
 * client in one call.
 */

import { configureErc8183, type JobClient } from "@settlekit/erc8183";
import { createDcwErc8183Port } from "./port.js";
import type { DcwErc8183Config } from "./types.js";

/**
 * Build a {@link JobClient} backed by the Circle Developer-Controlled-Wallet
 * ERC-8183 adapter.
 *
 * @example
 * const jobs = configureDcwErc8183({
 *   walletsClientConfig: { apiKey: process.env.CIRCLE_API_KEY!, entitySecretProvider },
 *   walletAddress: "0x...",
 *   evaluator: "0x...",
 *   defaultExpiredAt: "1750000000",
 *   hashToBytes32: (s) => keccak256(toHex(s)),
 *   decodeJobCreated: async (tx) => decodeJobCreatedFromReceipt(tx.txHash!),
 *   readJob: async (jobId) => readJobViaRpc(jobId),
 * });
 */
export function configureDcwErc8183(config: DcwErc8183Config): JobClient {
  return configureErc8183({ port: createDcwErc8183Port(config) });
}
