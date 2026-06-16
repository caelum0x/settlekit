/**
 * Minimal CCTP V2 contract ABIs.
 *
 * Only the entrypoints SettleKit calls are declared. Signatures mirror the
 * official contracts at https://github.com/circlefin/evm-cctp-contracts
 * (`src/v2/TokenMessengerV2.sol`, `src/v2/MessageTransmitterV2.sol`).
 */

/**
 * `TokenMessengerV2` burn entrypoints.
 *
 * `depositForBurn` burns `amount` of `burnToken` on the source chain and emits
 * a message routed to `destinationDomain`. V2 adds `maxFee` (the cap on the
 * on-chain mint fee) and `minFinalityThreshold` (1000 = Standard/hard finality,
 * <=500 selects Fast Transfer where supported). `depositForBurnWithHook` adds a
 * non-empty `hookData` payload executed on the destination after mint.
 */
export const TOKEN_MESSENGER_V2_ABI = [
  {
    type: "function",
    name: "depositForBurn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "depositForBurnWithHook",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

/**
 * `MessageTransmitterV2.receiveMessage` mint entrypoint. Submits the Circle
 * message and its concatenated attestation signatures on the destination chain
 * to mint USDC to the burn's `mintRecipient`.
 */
export const MESSAGE_TRANSMITTER_V2_ABI = [
  {
    type: "function",
    name: "receiveMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;
