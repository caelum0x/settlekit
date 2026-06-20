/**
 * Verbatim Arc-docs constants for the **real** AgenticCommerce ERC-8183
 * reference implementation on Arc Testnet, plus the ABI function-signature
 * strings the Circle Developer-Controlled-Wallet (DCW) contract-execution path
 * posts (DCW takes `abiFunctionSignature` + string `abiParameters`, so there is
 * no chain SDK / typed ABI here — these are plain strings, exactly the Arc-docs
 * convention).
 *
 * Source: Arc docs — AgenticCommerce reference impl. These addresses live here
 * as verbatim constants because `@settlekit/arc-chains` intentionally does NOT
 * carry on-chain addresses (it never invents them).
 *
 * Pure data only: no I/O, no chain SDK, no mutation.
 */

import type { JobStatus } from "@settlekit/erc8183";

/** AgenticCommerce reference impl address (Arc Testnet). */
export const AGENTIC_COMMERCE_ADDRESS =
  "0x0747EEf0706327138c69792bF28Cd525089e4583" as const;

/** USDC token address on Arc Testnet. */
export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;

/** Default Circle blockchain id for the DCW contract-execution calls. */
export const DEFAULT_BLOCKCHAIN = "ARC-TESTNET" as const;

/** The default (no-op) hook address: address(0). */
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/** Empty `bytes` optParams default, as a hex string. */
export const EMPTY_BYTES = "0x" as const;

/**
 * ABI function-signature strings, verbatim from the Arc docs. Posted to the DCW
 * contract-execution endpoint as `abiFunctionSignature`. `as const` keeps them
 * literal so callers cannot accidentally mistype a signature.
 */
export const ABI_SIGNATURES = {
  /** createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) -> uint256 */
  createJob: "createJob(address,address,uint256,string,address)",
  /** setBudget(uint256 jobId, uint256 amount, bytes optParams) — provider sets price. */
  setBudget: "setBudget(uint256,uint256,bytes)",
  /** approve(address spender, uint256 amount) — on USDC, client approves AgenticCommerce. */
  approve: "approve(address,uint256)",
  /** fund(uint256 jobId, bytes optParams) — client funds escrow -> Funded. */
  fund: "fund(uint256,bytes)",
  /** submit(uint256 jobId, bytes32 deliverable, bytes optParams) — provider -> Submitted. */
  submit: "submit(uint256,bytes32,bytes)",
  /** complete(uint256 jobId, bytes32 reason, bytes optParams) — evaluator -> Completed, releases escrow. */
  complete: "complete(uint256,bytes32,bytes)",
  /** getJob(uint256 jobId) — read-only; the DCW path has no read API (see readJob). */
  getJob: "getJob(uint256)",
} as const;

/**
 * On-chain Status enum (uint8) ordering, verbatim from the Arc docs:
 *   0 Open, 1 Funded, 2 Submitted, 3 Completed, 4 Rejected, 5 Expired.
 */
export const JOB_STATUS_BY_INDEX = [
  "Open",
  "Funded",
  "Submitted",
  "Completed",
  "Rejected",
  "Expired",
] as const;

/** A label from {@link JOB_STATUS_BY_INDEX}. */
export type OnChainStatusLabel = (typeof JOB_STATUS_BY_INDEX)[number];

/**
 * Map the on-chain uint8 status index to the `@settlekit/erc8183` {@link JobStatus}
 * union. This mapping is intentionally **lossy** — the on-chain enum and the
 * SettleKit lifecycle do not line up 1:1:
 *
 *   - 0 Open      -> "created"   (job exists; not yet funded)
 *   - 1 Funded    -> "funded"
 *   - 2 Submitted -> "submitted"
 *   - 3 Completed -> "settled"   (escrow released on complete)
 *   - 4 Rejected  -> "refunded"  (escrow returns to client via the Rejected path)
 *   - 5 Expired   -> "cancelled" (job lapsed before completion)
 *
 * There is NO on-chain "evaluated" state — the contract releases escrow directly
 * on `complete`, so `getJob` can never reconstruct an "evaluated" status.
 */
const STATUS_INDEX_TO_JOB_STATUS: Readonly<Record<number, JobStatus>> = {
  0: "created",
  1: "funded",
  2: "submitted",
  3: "settled",
  4: "refunded",
  5: "cancelled",
};

/**
 * Resolve the {@link JobStatus} for an on-chain status index, or `undefined`
 * when the index is out of the documented 0..5 range (callers decide how to
 * surface the unknown index — see port.ts).
 */
export function jobStatusFromIndex(index: number): JobStatus | undefined {
  return STATUS_INDEX_TO_JOB_STATUS[index];
}
