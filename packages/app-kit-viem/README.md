# @settlekit/app-kit-viem

A **viem-only** implementation of `@settlekit/app-kit`'s `AppKitSdk` port for the
**SEND** capability on Arc (a USDC ERC-20 `transfer`). It lets
`ArcSettlementProvider` settle real USDC using `viem` alone — **no
`@circle-fin` SDK required**.

## ⚠️ Scope — only SEND is supported

| Capability | viem backend |
| --- | --- |
| `send` / `estimateSend` | ✅ implemented (USDC `transfer`) |
| `bridge` | ❌ throws `SettleKitError` |
| `swap` | ❌ throws `SettleKitError` |
| `unifiedBalance.deposit` / `spend` | ❌ throws `SettleKitError` |

Bridge / swap / unified balance require Circle's cross-chain infrastructure.
**Use `@circle-fin/app-kit` for those flows.** Every unsupported call throws an
error whose message contains:

> `… not supported by the viem backend — use @circle-fin/app-kit for bridge/swap/unified balance`

## Wiring

```ts
import { createViemAppKitSdk } from "@settlekit/app-kit-viem";
import { configureAppKit, ArcSettlementProvider } from "@settlekit/app-kit";

const sdk = createViemAppKitSdk({
  // Signer: prefer env. NEVER hardcode the key.
  privateKeyEnv: "SETTLEKIT_PRIVATE_KEY", // default
  // arc-chains leaves these unpublished — inject verified values:
  chainId: 1234, // real Arc Testnet chainId (arc-chains uses 0 sentinel)
  tokenAddressOverrides: {
    Arc_Testnet: { USDC: "0xYourVerifiedUsdcAddress" },
  },
});

const appKit = configureAppKit({ sdk });
const provider = new ArcSettlementProvider({ client: appKit, adapter });
```

You can also inject a fully-built viem trio instead of a key:

```ts
const sdk = createViemAppKitSdk({
  wallet: { account, walletClient, publicClient },
  tokenAddressOverrides: { Arc_Testnet: { USDC: "0x…" } },
});
```

## Hard requirements (never invented)

- **USDC address** — `@settlekit/arc-chains` leaves `CHAIN_TOKENS.Arc_Testnet.USDC.address`
  `undefined`. You MUST supply `config.tokenAddressOverrides` until it is
  published; otherwise `send` throws a clear "not configured" error.
- **Arc chainId** — arc-chains uses the `0` sentinel for Arc. Supply
  `config.chainId` or `send` throws (we never invent it).
- **Private key** — read from `config.privateKey` or `env[SETTLEKIT_PRIVATE_KEY]`.
  Never hardcoded.

## Errors & retries

Transport/timeout failures are wrapped as `SettleKitError` with
`code: "integration_error"`, `retryable: true`, so `ArcSettlementProvider`'s
retry logic re-attempts them. A **confirmed reverted receipt** returns a
non-throwing `SdkResult` with `state: "failed"` (a terminal outcome).
