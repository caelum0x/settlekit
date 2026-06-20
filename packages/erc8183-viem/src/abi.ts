/**
 * `DEFAULT_ERC8183_ABI` — the ASSUMED ERC-8183 job-contract lifecycle surface.
 *
 * !!! CRITICAL: ASSUMED — confirm against the deployed contract. !!!
 *
 * The exact deployed ERC-8183 ABI is NOT published in this repo or the Arc docs
 * available to us. This ABI is reconstructed from the *documented lifecycle*
 * (createJob / fundEscrow / submitDeliverable / evaluate / settle / refund /
 * getJob) and the {@link import("@settlekit/erc8183").Job} shape. Function names,
 * argument order/types, the `getJob` return tuple layout, the `jobId` type
 * (assumed `uint256`), and the `status` `uint8` enum ordering may NOT match the
 * real contract.
 *
 * Because of this, {@link import("./port.js").createViemErc8183Port} accepts an
 * `abi` override in its config so a consumer can supply the real ABI WITHOUT a
 * code change to this package once the deployed contract is known.
 *
 * Typed `as const` so viem can infer argument/return types statically.
 */
export const DEFAULT_ERC8183_ABI = [
  {
    // assumed; confirm against deployed contract
    type: "function",
    name: "createJob",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requester", type: "address" },
      { name: "worker", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "specUri", type: "string" },
    ],
    outputs: [{ name: "jobId", type: "uint256" }],
  },
  {
    // assumed; confirm against deployed contract
    type: "function",
    name: "fundEscrow",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    // assumed; confirm against deployed contract
    type: "function",
    name: "submitDeliverable",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "deliverableUri", type: "string" },
    ],
    outputs: [],
  },
  {
    // assumed; confirm against deployed contract
    type: "function",
    name: "evaluate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "passed", type: "bool" },
      { name: "scoreOrUri", type: "string" },
    ],
    outputs: [],
  },
  {
    // assumed; confirm against deployed contract
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [],
  },
  {
    // assumed; confirm against deployed contract
    type: "function",
    name: "refund",
    stateMutability: "nonpayable",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [],
  },
  {
    // assumed; confirm against deployed contract
    type: "function",
    name: "getJob",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "requester", type: "address" },
          { name: "worker", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "deliverableUri", type: "string" },
          { name: "evaluated", type: "bool" },
          { name: "passed", type: "bool" },
          { name: "scoreOrUri", type: "string" },
        ],
      },
    ],
  },
] as const;

/**
 * Maps the on-chain `uint8` status enum to the erc8183
 * {@link import("@settlekit/erc8183").JobStatus} union.
 *
 * !!! ASSUMED — confirm against deployed contract. !!! The ordering mirrors the
 * lifecycle declared in `@settlekit/erc8183` `types.ts`
 * (created -> funded -> submitted -> evaluated -> settled -> refunded ->
 * cancelled). The real contract's enum ordering may differ.
 */
export const JOB_STATUS_BY_INDEX = [
  "created",
  "funded",
  "submitted",
  "evaluated",
  "settled",
  "refunded",
  "cancelled",
] as const;
