# @settlekit/erc8004-dcw

A Circle **Developer-Controlled-Wallet (DCW)** adapter that implements
`@settlekit/erc8004`'s `Erc8004Port` by mapping every on-chain WRITE to Circle
W3S **contract execution** and delegating every READ to an injected chain reader.

This is the "Circle Wallets" tab path of the ERC-8004 integration: instead of
signing transactions locally with viem/ethers, you let Circle's developer-
controlled wallet sign and broadcast them. The package takes **no viem and no
crypto dependency** — the few cryptographic/chain-read primitives it needs are
injected by the caller.

## How it works

```
register / giveFeedback / requestValidation / respondValidation
  -> client.createContractExecution({ abiFunctionSignature, abiParameters, ... })
  -> pollTransaction(client, { id })  // until COMPLETE / FAILED
  -> TxResult { txHash, explorerUrl }

findAgentId / ownerOf / tokenUri / getValidationStatus
  -> config.reader.*   // the DCW REST API has no on-chain read
```

ABI scalars (`uint256` / `int128` / `uint8` / `bytes32`) are passed to Circle as
**decimal or hex strings**, exactly as the Arc ERC-8004 docs require.

### DCW ABI signatures

| Operation           | Signature                                                                 | Target registry      |
| ------------------- | ------------------------------------------------------------------------- | -------------------- |
| `register`          | `register(string)`                                                        | IdentityRegistry     |
| `giveFeedback`      | `giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)`  | ReputationRegistry   |
| `requestValidation` | `validationRequest(address,uint256,string,bytes32)`                       | ValidationRegistry   |
| `respondValidation` | `validationResponse(bytes32,uint8,string,bytes32,string)`                 | ValidationRegistry   |

`feedbackHash = keccak256(toHex(tag))` and `requestHash = keccak256(toHex(subject))`.

## Required injection

Two things the DCW path cannot do itself **must** be supplied in config, or
construction throws `validation_error`:

- **`keccak256`** — a real keccak256 (e.g. `viem.keccak256`). Used to derive the
  feedback/request hashes. This package never hand-rolls crypto. It MUST be a
  genuine keccak256, and `toHex` MUST match the contract's pre-image encoding
  (UTF-8 bytes -> 0x-hex) or the hashes will not match on-chain values. A trivial
  non-cryptographic `utf8ToHex` is provided as the default `toHex`.
- **`reader`** — an `Erc8004Reader` for `findAgentId` / `ownerOf` / `tokenUri` /
  `getValidationStatus`. **The DCW REST API has no read capability** (it can only
  send transactions), so these require a separate RPC/viem reader. In particular,
  `findAgentId` resolves the agent's ERC-721 id from IdentityRegistry
  `Transfer(_, to=owner, tokenId)` logs — a log query the DCW path cannot do.

## Usage

```ts
import { createWalletsClient } from "@settlekit/circle-wallets";
import { createDcwErc8004Port } from "@settlekit/erc8004-dcw";
import { keccak256, toHex } from "viem"; // consumer already has viem

const client = createWalletsClient({ apiKey: process.env.CIRCLE_API_KEY! });

const port = createDcwErc8004Port({
  client,
  walletAddress: "0xYourDeveloperControlledWallet",
  keccak256,            // viem.keccak256
  toHex,                // viem.toHex (UTF-8 -> 0x-hex)
  reader: myViemReader, // your RPC-backed Erc8004Reader
  // entitySecretCiphertext or rely on client.entitySecretProvider
});

const { txHash } = await port.register({ metadataUri: "ipfs://agent.json" });
```

## Caveats

- **`blockchain: "ARC-TESTNET"`** — `DcwBlockchain` widens Circle's
  `CircleBlockchain` to include the Arc literal. Confirm the exact Circle W3S
  blockchain code for Arc Testnet against Circle's enum before mainnet use.
- **Polling latency** — `pollTransaction` defaults to 30 attempts × 2000 ms
  (~60s) of real timers. Tune `poll.attempts` / `poll.delayMs`, and inject
  `poll.sleep` only in tests.
- **ABI ordering** — the signatures above are taken from the Arc docs and are not
  verifiable from repo source; confirm against the deployed Arc contracts before
  mainnet.
- **Idempotency** — writes do not thread an `idempotencyKey` by default; repeated
  `register` calls could double-mint.
