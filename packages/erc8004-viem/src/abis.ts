/**
 * ERC-8004 registry ABIs on Arc, transcribed VERBATIM from the Arc docs.
 *
 * Each ABI is the minimal surface the live viem port needs. They are typed
 * `as const` so viem can infer argument and return types at the call site
 * (mirroring `packages/onchain/src/abi.ts` / `fx-escrow-abi.ts`).
 *
 * WARNING — UNVERIFIED: these shapes are taken from the docs/task brief and are
 * NOT cross-checked against the live deployed bytecode in this repo (no ERC-8004
 * ABI artifact exists under `packages/onchain`). A wrong `stateMutability` or
 * argument order will silently break encoding. Verify against the deployed
 * contracts with one Arc-testnet integration run before production use.
 */

/**
 * IdentityRegistry — agent identity as an ERC-721.
 *
 * - `register(string metadataURI)` mints a new agent identity.
 * - `ownerOf(uint256)` / `tokenURI(uint256)` are the standard ERC-721 reads.
 * - `Transfer` is the standard ERC-721 mint/transfer event; a mint has
 *   `from == address(0)` and is how {@link createViemErc8004Port}'s
 *   `findAgentId` discovers an owner's most recent agent id.
 */
export const IDENTITY_REGISTRY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "metadataURI", type: "string" }],
    outputs: [],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "owner", type: "address" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "uri", type: "string" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
] as const;

/**
 * ReputationRegistry — external validators record feedback about an agent.
 *
 * `score` is `int128` (signed; negative scores are valid). `feedbackHash` is a
 * caller-derived bytes32 commitment — see {@link feedbackHash}.
 */
export const REPUTATION_REGISTRY_ABI = [
  {
    type: "function",
    name: "giveFeedback",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "score", type: "int128" },
      { name: "feedbackType", type: "uint8" },
      { name: "tag", type: "string" },
      { name: "metadataURI", type: "string" },
      { name: "evidenceURI", type: "string" },
      { name: "comment", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

/**
 * ValidationRegistry — request/response attestation flow.
 *
 * `validationRequest` opens a request keyed by a caller-derived `requestHash`
 * (see {@link requestHash}); `validationResponse` answers it; `getValidationStatus`
 * reads the current tuple.
 */
export const VALIDATION_REGISTRY_ABI = [
  {
    type: "function",
    name: "validationRequest",
    stateMutability: "nonpayable",
    inputs: [
      { name: "validator", type: "address" },
      { name: "agentId", type: "uint256" },
      { name: "requestURI", type: "string" },
      { name: "requestHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "validationResponse",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestHash", type: "bytes32" },
      { name: "response", type: "uint8" },
      { name: "responseURI", type: "string" },
      { name: "responseHash", type: "bytes32" },
      { name: "tag", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getValidationStatus",
    stateMutability: "view",
    inputs: [{ name: "requestHash", type: "bytes32" }],
    outputs: [
      { name: "validatorAddress", type: "address" },
      { name: "agentId", type: "uint256" },
      { name: "response", type: "uint8" },
      { name: "responseHash", type: "bytes32" },
      { name: "tag", type: "string" },
      { name: "lastUpdate", type: "uint256" },
    ],
  },
] as const;
