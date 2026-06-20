# @settlekit/erc8004-viem

A **live [viem](https://viem.sh) adapter** that implements
`@settlekit/erc8004`'s `Erc8004Port` against the deployed **ERC-8004 registries
on Arc** (Identity, Reputation, Validation).

`@settlekit/erc8004` itself takes **no chain dependency** — it defines the port
interface and a `LocalErc8004Port` for tests/demos. This package is the
production implementation: it builds viem public/wallet clients, encodes the
documented ABIs, confirms transactions with `waitForTransactionReceipt`, and
returns Arc explorer URLs.

## Install & build

```bash
pnpm --filter @settlekit/erc8004-viem build   # tsc -b
pnpm --filter @settlekit/erc8004-viem test    # vitest run (no network)
```

## Usage

```ts
import { createViemErc8004Port } from "@settlekit/erc8004-viem";

// Reads only — public client from default Arc Testnet RPC.
const reader = createViemErc8004Port();
const owner = await reader.ownerOf({ agentId: "1" });

// Writes — supply a private key (from env) or an injected wallet client.
const port = createViemErc8004Port({ privateKey: process.env.ARC_PRIVATE_KEY as `0x${string}` });
const { txHash, explorerUrl } = await port.register({ metadataUri: "ipfs://…" });
```

## `createViemErc8004Port(config)`

| Field          | Type                  | Default                  | Notes |
| -------------- | --------------------- | ------------------------ | ----- |
| `rpcUrl`       | `string`              | `ARC_TESTNET_RPC_URL`    | from `@settlekit/erc8004` |
| `privateKey`   | `` `0x${string}` ``   | —                        | read from env/config; **never hardcode** |
| `walletClient` | viem `WalletClient`   | built from `privateKey`  | must carry an account |
| `publicClient` | viem `PublicClient`   | built from `rpcUrl`      | reads |
| `registries`   | `Erc8004Registries`   | `ARC_TESTNET_REGISTRIES` | from `@settlekit/arc-chains` |

Reads work with only an RPC URL / public client. Write methods require a wallet
(`walletClient` **or** `privateKey`); otherwise they throw a
`SettleKitError({ code: "validation_error" })`.

## Method → contract-call mapping

| Port method           | Registry            | Call                                   |
| --------------------- | ------------------- | -------------------------------------- |
| `register`            | IdentityRegistry    | `register(metadataURI)`                |
| `findAgentId`         | IdentityRegistry    | `getLogs(Transfer{to: owner})` → last `tokenId` |
| `ownerOf`             | IdentityRegistry    | `ownerOf(tokenId)`                     |
| `tokenUri`            | IdentityRegistry    | `tokenURI(tokenId)`                    |
| `giveFeedback`        | ReputationRegistry  | `giveFeedback(…, feedbackHash)`        |
| `requestValidation`   | ValidationRegistry  | `validationRequest(validator, agentId, requestURI, requestHash)` |
| `respondValidation`   | ValidationRegistry  | `validationResponse(requestHash, response, responseURI, responseHash, tag)` |
| `getValidationStatus` | ValidationRegistry  | `getValidationStatus(requestHash)`     |

## Hash derivation

The port owns commitment derivation, matching the Arc docs scheme:

- `feedbackHash(tag)` = `keccak256(toHex(tag))`
- `requestHash(subject)` = `keccak256(toHex(subject))`

Both are pure (`@settlekit/erc8004-viem` exports them), deterministic, and the
primary unit-test seam.

## Caveats (verify before production)

- **chainId.** `@settlekit/arc-chains` carries the `0` sentinel for Arc Testnet
  (not yet published there). viem requires a real chain id to sign transactions,
  so `defineArcChain` defaults to `5042002` (documented in `packages/arc`).
  Override via `defineArcChain({ chainId })` once verified on-chain.
- **Unverified ABIs.** The three ABIs are transcribed from the Arc docs and are
  **not** cross-checked against deployed bytecode. Wrong arg order /
  `stateMutability` silently breaks encoding — validate with one testnet run.
- **`responseHash`.** `ValidationResponseInput` has no `responseHash`, so
  `respondValidation` passes a zero bytes32. Confirm the contract accepts it.
- **`findAgentId` window.** Log scan is capped to the most recent 10 000 blocks;
  agents registered earlier are invisible, and some RPC providers cap ranges
  further.
- **No live-chain CI coverage.** The transactional method bodies are not
  exercised in CI (no network in tests). Run an env-gated integration test
  against Arc testnet before relying on it.

## Security

Never hardcode a private key. Supply `config.privateKey` from an environment
variable or secret manager, or inject a pre-built `walletClient`.
