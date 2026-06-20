/**
 * Minimal ERC-20 ABI fragments needed by the viem App Kit backend.
 *
 * `@settlekit/onchain` ships only `approve`, so the `transfer` fragment is
 * defined here. It is written `as const` so viem can infer `transfer`'s
 * argument tuple (`[Address, bigint]`) at the call site — never widen it.
 */

/** ERC-20 `transfer(address to, uint256 amount) -> bool`. */
export const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;
