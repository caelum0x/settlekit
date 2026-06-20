/**
 * `AGENTIC_COMMERCE_ABI` — the REAL deployed ERC-8183 AgenticCommerce reference
 * implementation surface, taken verbatim from the Arc docs.
 *
 * Contract: AgenticCommerce reference impl on Arc Testnet,
 * {@link DEFAULT_AGENTIC_COMMERCE_ADDRESS}. Escrow is denominated in USDC
 * ({@link DEFAULT_USDC_ADDRESS}, 6 decimals).
 *
 * Job lifecycle on-chain:
 *   createJob(provider, evaluator, expiredAt, description, hook) -> jobId
 *     (msg.sender becomes the `client`; jobId is recovered from the
 *      {@link JobCreated} event in the receipt — it is NOT a writeContract
 *      return value)
 *   setBudget(jobId, amount, optParams)   [provider sets the price]
 *   fund(jobId, optParams)                [client funds escrow -> Funded;
 *                                          requires a prior USDC approve()]
 *   submit(jobId, deliverable, optParams) [provider -> Submitted;
 *                                          deliverable is a bytes32 hash]
 *   complete(jobId, reason, optParams)    [evaluator -> Completed, releases
 *                                          escrow; reason is a bytes32 hash]
 *   getJob(jobId) -> tuple(id, client, provider, evaluator, description,
 *                          budget, expiredAt, status, hook)
 *
 * Typed `as const` so viem can infer argument/return types statically. The
 * `abi` override in {@link import("./types.js").ViemErc8183Config} remains for
 * forward-compatibility, but this default now matches the deployed contract.
 */
export const AGENTIC_COMMERCE_ABI = [
  {
    type: "function",
    name: "createJob",
    stateMutability: "nonpayable",
    inputs: [
      { name: "provider", type: "address" },
      { name: "evaluator", type: "address" },
      { name: "expiredAt", type: "uint256" },
      { name: "description", type: "string" },
      { name: "hook", type: "address" },
    ],
    outputs: [{ name: "jobId", type: "uint256" }],
  },
  {
    type: "function",
    name: "setBudget",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "fund",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "submit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "deliverable", type: "bytes32" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "complete",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "reason", type: "bytes32" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getJob",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "client", type: "address" },
          { name: "provider", type: "address" },
          { name: "evaluator", type: "address" },
          { name: "description", type: "string" },
          { name: "budget", type: "uint256" },
          { name: "expiredAt", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "hook", type: "address" },
        ],
      },
    ],
  },
  {
    type: "event",
    name: "JobCreated",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "client", type: "address", indexed: true },
      { name: "provider", type: "address", indexed: true },
      { name: "evaluator", type: "address", indexed: false },
      { name: "expiredAt", type: "uint256", indexed: false },
      { name: "hook", type: "address", indexed: false },
    ],
  },
] as const;

/**
 * Backwards-compatible alias. The "default ERC-8183 ABI" is now the REAL
 * deployed AgenticCommerce ABI ({@link AGENTIC_COMMERCE_ABI}).
 */
export const DEFAULT_ERC8183_ABI = AGENTIC_COMMERCE_ABI;

/**
 * Minimal USDC ERC-20 ABI: the `approve` the client must send to authorize the
 * AgenticCommerce contract to pull escrow during `fund`, plus the `allowance`
 * view for diagnostics. Typed `as const` for viem inference.
 */
export const USDC_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Alias for the minimal ERC-20 approve ABI used during `fundEscrow`. */
export const ERC20_APPROVE_ABI = USDC_ABI;

/** A 0x-prefixed hex string (re-declared here to avoid a runtime import cycle). */
type HexLiteral = `0x${string}`;

/**
 * REAL deployed AgenticCommerce (ERC-8183) reference implementation on Arc
 * Testnet. Overridable via `config.contractAddress`.
 */
export const DEFAULT_AGENTIC_COMMERCE_ADDRESS: HexLiteral =
  "0x0747EEf0706327138c69792bF28Cd525089e4583";

/** REAL USDC token on Arc. Overridable via `config.usdcAddress`. */
export const DEFAULT_USDC_ADDRESS: HexLiteral =
  "0x3600000000000000000000000000000000000000";

/**
 * Maps the REAL on-chain `uint8` status enum (0..5) to the erc8183
 * {@link import("@settlekit/erc8183").JobStatus} union.
 *
 * On-chain enum -> SettleKit JobStatus:
 *   0 Open      -> "created"
 *   1 Funded    -> "funded"
 *   2 Submitted -> "submitted"
 *   3 Completed -> "settled"    (escrow released to the provider)
 *   4 Rejected  -> "refunded"   (escrow returns to the client)
 *   5 Expired   -> "cancelled"
 *
 * Note: the on-chain enum has no distinct "evaluated" state — `complete`
 * settles directly, so on-chain `Completed` maps to SettleKit `settled`.
 */
export const JOB_STATUS_BY_INDEX = [
  "created",
  "funded",
  "submitted",
  "settled",
  "refunded",
  "cancelled",
] as const;
