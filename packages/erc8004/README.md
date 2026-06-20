# @settlekit/erc8004

ERC-8004 agent identity, reputation, and validation on [Arc](https://docs.arc.io),
exposed through a SettleKit-idiomatic facade that returns `Result` values instead
of throwing.

ERC-8004 gives autonomous agents:

- **Identity** — an ERC-721 minted by the **IdentityRegistry** (`register(string)`).
- **Reputation** — feedback attestations recorded by external validators in the
  **ReputationRegistry** (`giveFeedback(...)`).
- **Validation** — a request/response flow in the **ValidationRegistry**
  (`validationRequest(...)` / `validationResponse(...)` / `getValidationStatus(bytes32)`).

Deployed Arc Testnet registry addresses are exported from
[`src/addresses.ts`](./src/addresses.ts) as `ARC_TESTNET_REGISTRIES`.

## Design: port / adapter (no chain dependency)

This package depends only on `@settlekit/common`. It **never imports a chain
library**. The on-chain operations are declared as an injectable interface — the
[`Erc8004Port`](./src/port.ts) — which the consumer implements with viem, ethers,
or Circle Developer-Controlled Wallets, capturing the signing adapter by closure.

This mirrors the proven pattern in `@settlekit/app-kit`. Benefits: the package
stays dependency-light and chain-agnostic, and tests/demos inject a deterministic
[`LocalErc8004Port`](./src/local-port.ts).

## Quickstart (deterministic, in-memory)

```ts
import { configureErc8004, LocalErc8004Port } from "@settlekit/erc8004";
import { isOk } from "@settlekit/common";

const port = new LocalErc8004Port({ owner: "0xowner" });
const registry = configureErc8004({ port });

const reg = await registry.registerAgent({ metadataUri: "ipfs://agent.json" });
if (isOk(reg)) console.log(reg.value.txHash); // 0xlocal00000001

const agent = await registry.resolveAgent({ owner: "0xowner" });
if (isOk(agent) && agent.value) console.log(agent.value.agentId); // "1"
```

## API reference: `AgentRegistryClient`

Every method returns `Promise<Result<T>>` from `@settlekit/common`
(`ok(value)` / `err(SettleKitError)`). Validation failures short-circuit with
`code: "validation_error"`; thrown port errors are mapped to
`code: "integration_error"` (`retryable: true`).

| Method | Validates | Returns |
| --- | --- | --- |
| `registerAgent({ metadataUri })` | non-empty `metadataUri` | `TxResult` |
| `resolveAgent({ owner })` | non-empty `owner` | `AgentIdentity \| null` |
| `giveFeedback(FeedbackInput)` | non-empty `agentId`/`tag`, integer `score` 0..100, `feedbackType` 0..255 (default 0) | `TxResult` |
| `requestValidation(ValidationRequestInput)` | non-empty `agentId`/`validator`/`requestUri`/`subject` | `ValidationRequestResult` (`TxResult` + `requestHash`) |
| `respondValidation(ValidationResponseInput)` | non-empty `requestHash`, integer `response` 0..100 | `TxResult` |
| `getValidationStatus({ requestHash })` | non-empty `requestHash` | `ValidationStatus` |

`resolveAgent` returns `ok(null)` when the owner has no registered agent.

### `requestHash` is port-owned

`requestValidation` does NOT take a hash — the **port** derives `requestHash`
from the stable `subject` string and returns it. The same subject reproduces the
same hash, so status can be looked up later.

`LocalErc8004Port` uses an FNV-1a hash (padded to a bytes32-shaped hex) for
stable in-memory lookup. **This is not chain-compatible.** A real on-chain port
must derive `requestHash` with the ValidationRegistry's actual scheme (typically
`keccak256`) so it matches what the contract stores.

## On-chain contract signatures

The consumer's port maps the domain inputs onto these ValidationRegistry /
ReputationRegistry / IdentityRegistry calls:

```solidity
// IdentityRegistry
register(string metadataUri)

// ReputationRegistry
giveFeedback(uint256 agentId, int128 score, uint8 feedbackType,
             string tag, string metadataUri, string evidenceUri,
             string comment, bytes32 ref)

// ValidationRegistry
validationRequest(address validator, uint256 agentId, string requestUri, bytes32 requestHash)
validationResponse(bytes32 requestHash, uint8 response, string responseUri, bytes32 tag, string note)
getValidationStatus(bytes32 requestHash)
```

Note: `score` is `int128` on-chain. This package validates `score` as an integer
in 0..100 (the documented convention); a consumer needing the wider `int128`
range can relax that in its own port.

## Wiring sketch 1 — viem

The port is consumer-owned (this package adds no viem dependency):

```ts
import {
  createPublicClient, createWalletClient, http, keccak256, toHex, getAddress,
} from "viem";
import type { Erc8004Port } from "@settlekit/erc8004";
import { ARC_TESTNET_REGISTRIES, ARC_TESTNET_RPC_URL, explorerTxUrl } from "@settlekit/erc8004";

// Provide your own ABIs for the three registries.
import { identityAbi, reputationAbi, validationAbi } from "./abis.js";

export function createViemErc8004Port(opts: {
  account: `0x${string}`;
  transport?: ReturnType<typeof http>;
}): Erc8004Port {
  const transport = opts.transport ?? http(ARC_TESTNET_RPC_URL);
  const pub = createPublicClient({ transport });
  const wallet = createWalletClient({ account: opts.account, transport });
  const r = ARC_TESTNET_REGISTRIES;

  return {
    async register({ metadataUri }) {
      const txHash = await wallet.writeContract({
        address: r.identityRegistry as `0x${string}`,
        abi: identityAbi,
        functionName: "register",
        args: [metadataUri],
      });
      return { txHash, explorerUrl: explorerTxUrl(txHash) };
    },

    async findAgentId({ owner }) {
      const id = (await pub.readContract({
        address: r.identityRegistry as `0x${string}`,
        abi: identityAbi,
        functionName: "agentIdOf",
        args: [getAddress(owner)],
      })) as bigint;
      return id === 0n ? null : id.toString();
    },

    async ownerOf({ agentId }) {
      return (await pub.readContract({
        address: r.identityRegistry as `0x${string}`,
        abi: identityAbi,
        functionName: "ownerOf",
        args: [BigInt(agentId)],
      })) as string;
    },

    async tokenUri({ agentId }) {
      return (await pub.readContract({
        address: r.identityRegistry as `0x${string}`,
        abi: identityAbi,
        functionName: "tokenURI",
        args: [BigInt(agentId)],
      })) as string;
    },

    async giveFeedback(input) {
      const txHash = await wallet.writeContract({
        address: r.reputationRegistry as `0x${string}`,
        abi: reputationAbi,
        functionName: "giveFeedback",
        args: [
          BigInt(input.agentId), BigInt(input.score), input.feedbackType ?? 0,
          input.tag, input.metadataUri ?? "", input.evidenceUri ?? "",
          input.comment ?? "", "0x".padEnd(66, "0") as `0x${string}`,
        ],
      });
      return { txHash, explorerUrl: explorerTxUrl(txHash) };
    },

    async requestValidation(input) {
      // The port owns hashing — keep this aligned with the contract's scheme.
      const requestHash = keccak256(toHex(input.subject));
      const txHash = await wallet.writeContract({
        address: r.validationRegistry as `0x${string}`,
        abi: validationAbi,
        functionName: "validationRequest",
        args: [getAddress(input.validator), BigInt(input.agentId), input.requestUri, requestHash],
      });
      return { txHash, explorerUrl: explorerTxUrl(txHash), requestHash };
    },

    async respondValidation(input) {
      const txHash = await wallet.writeContract({
        address: r.validationRegistry as `0x${string}`,
        abi: validationAbi,
        functionName: "validationResponse",
        args: [
          input.requestHash as `0x${string}`, input.response, input.responseUri ?? "",
          ("0x" + (input.tag ?? "").padEnd(64, "0")).slice(0, 66) as `0x${string}`, "",
        ],
      });
      return { txHash, explorerUrl: explorerTxUrl(txHash) };
    },

    async getValidationStatus({ requestHash }) {
      const [validator, agentId, response, tag] = (await pub.readContract({
        address: r.validationRegistry as `0x${string}`,
        abi: validationAbi,
        functionName: "getValidationStatus",
        args: [requestHash as `0x${string}`],
      })) as [string, bigint, number, string];
      return { validator, agentId: agentId.toString(), response, tag, passed: response === 100 };
    },
  };
}
```

```ts
import { configureErc8004 } from "@settlekit/erc8004";
const registry = configureErc8004({ port: createViemErc8004Port({ account }) });
```

## Wiring sketch 2 — Circle Developer-Controlled Wallets

Submit the same contract calls through DCW contract-execution. Encode the
function call (e.g. with viem's `encodeFunctionData`) and submit via the DCW SDK:

```ts
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { encodeFunctionData, keccak256, toHex } from "viem";
import type { Erc8004Port } from "@settlekit/erc8004";
import { ARC_TESTNET_REGISTRIES, explorerTxUrl } from "@settlekit/erc8004";
import { identityAbi, reputationAbi, validationAbi } from "./abis.js";

export function createCircleDcwErc8004Port(opts: {
  walletId: string;
  apiKey: string;
  entitySecret: string;
}): Erc8004Port {
  const dcw = initiateDeveloperControlledWalletsClient({
    apiKey: opts.apiKey,
    entitySecret: opts.entitySecret,
  });
  const r = ARC_TESTNET_REGISTRIES;

  async function exec(address: string, callData: `0x${string}`) {
    const res = await dcw.createContractExecutionTransaction({
      walletId: opts.walletId,
      contractAddress: address,
      callData,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });
    const txHash = res.data?.txHash ?? res.data?.id ?? "";
    return { txHash, explorerUrl: explorerTxUrl(txHash) };
  }

  return {
    async register({ metadataUri }) {
      return exec(
        r.identityRegistry,
        encodeFunctionData({ abi: identityAbi, functionName: "register", args: [metadataUri] }),
      );
    },
    async requestValidation(input) {
      const requestHash = keccak256(toHex(input.subject)); // align with contract scheme
      const tx = await exec(
        r.validationRegistry,
        encodeFunctionData({
          abi: validationAbi,
          functionName: "validationRequest",
          args: [input.validator, BigInt(input.agentId), input.requestUri, requestHash],
        }),
      );
      return { ...tx, requestHash };
    },
    // findAgentId / ownerOf / tokenUri / getValidationStatus are read-only:
    // use a viem/ethers public client (DCW is for signing writes), or the
    // chain RPC directly. giveFeedback / respondValidation mirror register
    // via encodeFunctionData + exec(...).
    findAgentId: async () => null,
    ownerOf: async () => "",
    tokenUri: async () => "",
    giveFeedback: async (input) =>
      exec(
        r.reputationRegistry,
        encodeFunctionData({
          abi: reputationAbi,
          functionName: "giveFeedback",
          args: [
            BigInt(input.agentId), BigInt(input.score), input.feedbackType ?? 0,
            input.tag, input.metadataUri ?? "", input.evidenceUri ?? "",
            input.comment ?? "", ("0x".padEnd(66, "0")) as `0x${string}`,
          ],
        }),
      ),
    respondValidation: async (input) =>
      exec(
        r.validationRegistry,
        encodeFunctionData({
          abi: validationAbi,
          functionName: "validationResponse",
          args: [
            input.requestHash as `0x${string}`, input.response, input.responseUri ?? "",
            ("0x".padEnd(66, "0")) as `0x${string}`, "",
          ],
        }),
      ),
    getValidationStatus: async () => {
      throw new Error("read getValidationStatus via a public client");
    },
  };
}
```

> The two sketches are illustrative. ABIs, the exact read function names
> (`agentIdOf`, etc.), and the contract's `requestHash` scheme must match the
> deployed Arc registries — confirm against the Arc docs before mainnet use.

## Testing

```bash
pnpm --filter @settlekit/erc8004 build
pnpm --filter @settlekit/erc8004 test
```

`LocalErc8004Port` is fully deterministic (no `Date.now()` / `Math.random()`):
sequential agent ids, counter-based tx hashes, FNV-1a request hashes.
