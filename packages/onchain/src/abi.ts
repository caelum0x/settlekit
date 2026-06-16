/**
 * ABIs for the SettleKit Arc contracts (see `/contracts`). Hand-written minimal
 * surfaces — the writable functions the tx-builders need plus the key reads —
 * kept in sync with `contracts/src/*.sol`.
 */

/** `SettleKitEscrow` — trustless USDC escrow. */
export const SETTLEKIT_ESCROW_ABI = [
  {
    type: "function",
    name: "createAndFund",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "seller", type: "address" },
      { name: "arbiter", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "release",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "refund",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "dispute",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "escrows",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "buyer", type: "address" },
          { name: "seller", type: "address" },
          { name: "arbiter", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "state", type: "uint8" },
        ],
      },
    ],
  },
] as const;

/** Minimal ERC-20 `approve` surface (e.g. approving the escrow for USDC). */
export const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

/** `SettleKitCctpHook` — CCTP V2 hook target that credits a merchant on mint. */
export const SETTLEKIT_CCTP_HOOK_ABI = [
  {
    type: "function",
    name: "handleReceiveFinalizedMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "sourceDomain", type: "uint32" },
      { name: "sender", type: "bytes32" },
      { name: "finalityThresholdExecuted", type: "uint32" },
      { name: "messageBody", type: "bytes" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "event",
    name: "OrderSettled",
    inputs: [
      { name: "orderId", type: "bytes32", indexed: true },
      { name: "merchant", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "sourceDomain", type: "uint32", indexed: false },
    ],
  },
] as const;
