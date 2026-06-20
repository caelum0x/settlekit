# @settlekit/erc8183-dcw

A Circle **Developer-Controlled-Wallet (DCW)** adapter implementing
`@settlekit/erc8183`'s `Erc8183Port` against the **real** AgenticCommerce
ERC-8183 reference contract on Arc Testnet, via `@settlekit/circle-wallets`
`createContractExecution` + `pollTransaction`.

**No viem / chain SDK dependency.** DCW posts `abiFunctionSignature` strings and
string `abiParameters` (the Arc-docs convention), so this package carries no
chain SDK.

## Contract (verbatim, Arc docs)

- AgenticCommerce: `0x0747EEf0706327138c69792bF28Cd525089e4583` (Arc Testnet)
- USDC: `0x3600000000000000000000000000000000000000` (6 decimals)
- Blockchain id: `ARC-TESTNET`

## Port → contract mapping

| Port method                  | On-chain call                                           |
| ---------------------------- | ------------------------------------------------------- |
| `createJob`                  | `createJob(...)` then `setBudget(...)` (when amount > 0) |
| `fundEscrow`                 | USDC `approve(contract, amount)` THEN `fund(jobId)`     |
| `submitDeliverable`          | `submit(jobId, bytes32, 0x)`                            |
| `evaluate({passed:true})`    | `complete(jobId, bytes32, 0x)` (escrow releases)        |
| `settle`                     | `complete(jobId, bytes32, 0x)`                          |
| `evaluate({passed:false})`   | **No on-chain call** — throws (Rejected/Expired path)   |
| `refund`                     | **No on-chain function** — throws                       |
| `getJob`                     | injected `readJob` (DCW has no read API)                |

## Injected dependencies (never faked)

The DCW path can only POST transactions — it has no contract-read API and
`createContractExecution` does not return contract return-values. The consumer
must supply (typically via a separate RPC / viem-free reader **outside** this
package):

- `hashToBytes32(value)` — keccak256 → 0x 32-byte hex for `bytes32` deliverable /
  reason. One-way: the original URI/score is **not** recoverable on-chain.
- `decodeJobCreated(tx)` — decode the `JobCreated` event from the completed
  `createJob` receipt to recover `jobId`.
- `readJob(jobId)` — read the `getJob` tuple.

Also required (no `Erc8183Port` field exists for them): `evaluator` and
`defaultExpiredAt`.

## Lossy mapping notes

- On-chain Status enum (`0 Open .. 5 Expired`) → SettleKit `JobStatus` is lossy:
  `0→created, 1→funded, 2→submitted, 3→settled, 4→refunded, 5→cancelled`. There
  is no on-chain `evaluated` state.
- `getJob` cannot reconstruct `deliverableUri` / evaluation (bytes32 hashes are
  one-way).
- `fundEscrow` is two non-atomic DCW calls; the **fund** tx hash is surfaced and
  an approve failure aborts before fund.
- Circle requires a fresh entity-secret ciphertext **per call**; for the
  multi-call flows (`createJob`, `fundEscrow`) prefer an `entitySecretProvider`
  on the wallets client over a single static ciphertext.

## Usage

```ts
import { configureDcwErc8183 } from "@settlekit/erc8183-dcw";

const jobs = configureDcwErc8183({
  walletsClientConfig: { apiKey: process.env.CIRCLE_API_KEY!, entitySecretProvider },
  walletAddress: "0x...",       // the DCW signer (on-chain client)
  evaluator: "0x...",
  defaultExpiredAt: "1750000000",
  hashToBytes32: (s) => keccak256(toHex(s)),
  decodeJobCreated: async (tx) => decodeJobCreatedFromReceipt(tx.txHash!),
  readJob: async (jobId) => readJobViaRpc(jobId),
});
```
