# @settlekit/erc8183-viem

A live, **ABI-injectable** [viem](https://viem.sh) adapter implementing
`@settlekit/erc8183`'s `Erc8183Port` against the deployed ERC-8183 job contract
on Arc. It maps each lifecycle method (`createJob` / `fundEscrow` /
`submitDeliverable` / `evaluate` / `settle` / `refund` / `getJob`) to a contract
write or read, and maps the on-chain job tuple to the SettleKit `Job` type.

## Usage

### From an RPC URL + signer

```ts
import { configureViemErc8183, readPrivateKeyFromEnv } from "@settlekit/erc8183-viem";

const jobs = configureViemErc8183({
  contractAddress: "0x...", // deployed ERC-8183 job contract
  rpcUrl: "https://rpc.testnet.arc.network/",
  chainId: 1234,            // REQUIRED — see "Arc chainId gap" below
  privateKey: readPrivateKeyFromEnv(process.env), // never hardcode
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
  contractAddress: "0x...",
  walletClient, // a viem WalletClient WITH an account
  publicClient, // a viem PublicClient
});
```

When clients are injected they are used **verbatim** — no transport (`http()`)
is created. This is also how the test suite runs with zero network.

## ABI is assumed — confirm against the deployed contract

The exact deployed ERC-8183 ABI is **not** published in this repo. `DEFAULT_ERC8183_ABI`
is reconstructed from the documented lifecycle and the `Job` shape. Function
names, argument order, the `getJob` return tuple layout, the `jobId` type
(assumed `uint256`), and the `status` `uint8` enum ordering may **not** match the
real contract. Every ABI entry is commented `assumed; confirm against deployed
contract`.

Once the real ABI is known, override it **without a code change**:

```ts
import { createViemErc8183Port } from "@settlekit/erc8183-viem";
import { REAL_ERC8183_ABI } from "./my-abi"; // your verified ABI

createViemErc8183Port({ contractAddress, walletClient, publicClient, abi: REAL_ERC8183_ABI });
```

`createJob` is the most likely-to-differ piece: it currently `simulateContract`s
to recover an assumed `uint256` return value, then broadcasts. A real contract
may instead emit an event whose log you must decode for the job id.

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

> Note: if the deployed `fundEscrow` requires a prior ERC-20 `approve` of the
> escrow (like SettleKit's onchain escrow) you will also need the Arc USDC token
> address and an approval step. The USDC address on Arc Testnet is not published
> in this repo, so allowance handling is out of scope here — confirm against the
> real contract's escrow mechanics.

## Never hardcode a private key

Read keys from config or the environment. `readPrivateKeyFromEnv(process.env)`
returns the `ERC8183_PRIVATE_KEY` value (or `undefined` if unset) and validates
its shape. The pure `resolveAccount`/`isPrivateKey` helpers never touch
`process.env` and never log key material.
