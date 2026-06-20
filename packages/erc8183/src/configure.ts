/**
 * One factory to build a {@link JobClient}. The consumer injects a configured
 * {@link Erc8183Port} — there is no kit key or secret to read here, but the
 * factory shape mirrors {@link import("@settlekit/app-kit").configureAppKit} for
 * parity across SettleKit packages.
 *
 * Live wiring (in the consumer, which owns the viem + Circle DCW dependencies):
 *
 * ```ts
 * import { createWalletClient, http } from "viem";
 * import { configureErc8183, type Erc8183Port } from "@settlekit/erc8183";
 *
 * // Build a viem walletClient backed by a Circle Developer-Controlled Wallets
 * // signer, then implement the port against the ERC-8183 job contract:
 * const port: Erc8183Port = {
 *   async createJob({ requester, worker, amountUsdc, specUri }) {  ... },
 *   async fundEscrow({ jobId, amountUsdc }) {  ... },
 *    // submitDeliverable / evaluate / settle / refund / getJob
 * };
 *
 * const jobs = configureErc8183({ port });
 * const created = await jobs.createJob({ requester, worker, amountUsdc: "100.00", specUri });
 * ```
 *
 * Tests/demos inject {@link import("./local-port.js").LocalErc8183Port} instead.
 */

import { JobClient, type JobClientConfig } from "./client.js";

/** Options for {@link configureErc8183}. */
export interface ConfigureErc8183Options {
  /** The injected ERC-8183 port. */
  port: JobClientConfig["port"];
}

/** Build a configured {@link JobClient}. */
export function configureErc8183(options: ConfigureErc8183Options): JobClient {
  return new JobClient({ port: options.port });
}
