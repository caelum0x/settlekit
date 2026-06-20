# @settlekit/erc8183-viem

A live [viem](https://viem.sh) adapter implementing `@settlekit/erc8183`'s
`Erc8183Port` against the **REAL deployed AgenticCommerce (ERC-8183)** reference
implementation on Arc. It maps each SettleKit lifecycle method to the real
contract surface (`createJob` / `setBudget` / `fund` / `submit` / `complete` /
`getJob`) and maps the on-chain job tuple to the SettleKit `Job` type.

Defaults (all overridable via config):

- AgenticCommerce contract: `0x0747EEf0706327138c69792bF28Cd525089e4583` (Arc Testnet)
- USDC token: `0x3600000000000000000000000000000000000000`

## Usage

### From an RPC URL + signer

```ts
import { configureViemErc8183, readPrivateKeyFromEnv } from "@settlekit/erc8183-viem";

const jobs = configureViemErc8183({
  // contractAddress / usdcAddress default to the deployed addresses above
  rpcUrl: "https://rpc.testnet.arc.network/",
  chainId: 1234,            // REQUIRED — see "Arc chainId gap" below
  privateKey: readPrivateKeyFromEnv(process.env), // never hardcode
  // evaluator/expiredAt/hook supply the real createJob params the Port lacks:
  evaluator: "0x...",       // defaults to the requester when omitted
  expiredAt: 1893456000n,   // unix seconds; defaults to 0 (no expiry)
});

const created = await jobs.createJob({
  requester: "0x...",
  worker: "0x...",
  amountUsdc: "100.00",
  specUri: "ipfs://...",
});
```

### From injected viem clients

```ts
import { createViemErc8183Port } from "@settlekit/erc8183-viem";

const port = createViemErc8183Port({
  walletClient, // a viem WalletClient WITH an account
  publicClient, // a viem PublicClient
  // contractAddress / usdcAddress default to the deployed addresses
});
```

When clients are injected they are used **verbatim** — no transport (`http()`)
is created. This is also how the test suite runs with zero network.

## Port → contract mapping

The default ABI (`AGENTIC_COMMERCE_ABI`, also exported as `DEFAULT_ERC8183_ABI`)
is the **real** deployed surface. The fixed `Erc8183Port` methods map as:

| Port method        | On-chain call(s)                                              | Notes |
| ------------------ | ------------------------------------------------------------ | ----- |
| `createJob`        | `createJob(provider, evaluator, expiredAt, description, hook)` then `setBudget` when `amountUsdc > 0` | `jobId` is **decoded from the `JobCreated` receipt log** (not a return value). `requester → client` (msg.sender), `worker → provider`, `specUri → description`. |
| `fundEscrow`       | USDC `approve(contract, amount)` **then** `fund(jobId, "0x")` | The fund receipt is the returned `TxResult`. |
| `submitDeliverable`| `submit(jobId, keccak256(toHex(deliverableUri)), "0x")`      | The deliverable is stored as a `bytes32` hash. |
| `evaluate`         | `complete(jobId, keccak256(toHex(scoreOrUri)), "0x")`        | `complete` **releases escrow**. There is no on-chain fail method, so `evaluate({ passed: false })` still calls `complete` — a failing verdict cannot be expressed on-chain via this Port. |
| `settle`           | `complete(jobId, keccak256(toHex("settle")), "0x")`          | Redundant once `evaluate` has run `complete`. |
| `refund`           | **none** — throws a `SettleKitError`                         | Escrow returns via the Rejected/Expired job paths, not a method on this contract. |
| `getJob`           | `getJob(jobId)` → 9-field tuple                              | `deliverableUri`/`evaluation` are **omitted**: the contract stores only `bytes32` hashes, not the URI/verdict. |

### Interface gap

`Erc8183Port.createJob` only passes `{ requester, worker, amountUsdc, specUri }`,
but the real `createJob` also needs `evaluator`, `expiredAt`, and `hook`. Those
are supplied via config (`evaluator` defaults to the requester, `hook` to the
zero address, `expiredAt` to `0`). Set them explicitly for production — a wrong
evaluator default routes the job's verdict to an unintended party.

The on-chain `uint8` status enum maps `0..5` →
`created / funded / submitted / settled / refunded / cancelled`
(`JOB_STATUS_BY_INDEX`).

## Arc chainId gap

Arc Testnet's `chainId` is the `0` sentinel in `@settlekit/arc-chains`
(unpublished — deliberately not invented). viem signing depends on a real chain
id, so you **must** pass `config.chainId` until the real value is published.
`defineArcChain()` throws a `validation_error` if it resolves to `0` with no
override.

## USDC amounts (6 decimals)

Amounts arrive as **decimal strings** (`amountUsdc: "100.00"`) and are converted
to 6-decimal base units with integer-only BigInt math (no floating point) via
`@settlekit/common`'s `toBaseUnits`/`fromBaseUnits`. The viem `parseUnits`/
`formatUnits` (with `6`) equivalents are exported as `parseUsdc`/`formatUsdc` and
agree with the common helpers.

> `fundEscrow` performs the ERC-20 `approve` on the USDC token
> (`config.usdcAddress`, default `0x3600…0000`) for the AgenticCommerce contract,
> then calls `fund`. Both amounts use the same 6-decimal base-unit conversion.

## Never hardcode a private key

Read keys from config or the environment. `readPrivateKeyFromEnv(process.env)`
returns the `ERC8183_PRIVATE_KEY` value (or `undefined` if unset) and validates
its shape. The pure `resolveAccount`/`isPrivateKey` helpers never touch
`process.env` and never log key material.
