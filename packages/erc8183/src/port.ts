/**
 * {@link Erc8183Port} — the minimal on-chain surface this package depends on, a
 * *port* the consumer injects (dependency inversion, like settlement-core's
 * providers). A real viem + Circle Developer-Controlled Wallets implementation
 * against the ERC-8183 job contract satisfies this shape; tests and demos use
 * {@link LocalErc8183Port}.
 *
 * Keeping the contract here means this package never imports a chain SDK and so
 * adds no external dependency — the consumer owns viem/DCW and supplies the
 * implementation.
 */

import type { Job, TxResult } from "./types.js";

/** The injected ERC-8183 on-chain job contract. */
export interface Erc8183Port {
  /** Create a new job on-chain and post its spec. */
  createJob(p: {
    requester: string;
    worker: string;
    amountUsdc: string;
    specUri: string;
  }): Promise<{ jobId: string; txHash: string }>;

  /** Fund the USDC escrow for an existing job. */
  fundEscrow(p: { jobId: string; amountUsdc: string }): Promise<TxResult>;

  /** Submit a deliverable for a funded job. */
  submitDeliverable(p: { jobId: string; deliverableUri: string }): Promise<TxResult>;

  /** Record an evaluation verdict for a submitted job. */
  evaluate(p: { jobId: string; passed: boolean; scoreOrUri?: string }): Promise<TxResult>;

  /** Settle the escrow to the worker (legal only after a passing evaluation). */
  settle(p: { jobId: string }): Promise<TxResult>;

  /** Refund the escrow to the requester. */
  refund(p: { jobId: string }): Promise<TxResult>;

  /** Read the current on-chain state of a job. */
  getJob(p: { jobId: string }): Promise<Job>;
}
