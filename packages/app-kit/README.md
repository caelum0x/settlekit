# @settlekit/app-kit

Circle App Kit money movement on Arc — Send, Bridge, Swap, and Unified Balance — wrapped in SettleKit idioms.

[App Kit](https://docs.arc.io/app-kit) (`@circle-fin/app-kit`) composes multichain payment and liquidity flows behind one type-safe interface over Circle's Gateway and CCTP protocols. This package wraps that surface with decimal-USDC amounts, boundary validation, and `Result`-typed outcomes that never throw across the boundary.

## Design: inject the SDK, take no dependency

Following the `settlement-core` provider pattern, this package defines the App Kit surface it needs (`AppKitSdk`) and the **consumer injects** a configured client. So `@settlekit/app-kit` itself depends only on `@settlekit/common` — it never imports `@circle-fin/app-kit`, builds offline, and bundles anywhere. The consumer owns the SDK + adapter dependencies.

## Usage

```ts
import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { configureAppKit } from "@settlekit/app-kit";

const arc = configureAppKit({ sdk: new AppKit() }); // kit key from CIRCLE_KIT_KEY
const adapter = createViemAdapterFromProvider(provider);

// Send USDC on Arc
const sent = await arc.send({ adapter, chain: "Arc_Testnet", to: "0x…", amount: "1.00" });
if (sent.ok) console.log(sent.value.txHash, sent.value.explorerUrl);

// Bridge USDC into Arc
await arc.bridge({ adapter, fromChain: "Ethereum_Sepolia", toChain: "Arc_Testnet", amount: "1.00" });

// Swap USDC → EURC on Arc (requires a kit key)
await arc.swap({ adapter, chain: "Arc_Testnet", tokenIn: "USDC", tokenOut: "EURC", amountIn: "1.00" });

// Unified Balance: deposit from many chains, spend on Arc
await arc.deposit({ adapter, chain: "Base_Sepolia", amount: "1.00" });
await arc.spend({ adapter, toChain: "Arc_Testnet", recipientAddress: "0x…", amount: "1.50" });
```

Every method returns `Result<TransferResult>`: `{ kind, status, txHash?, explorerUrl?, operation? }`, where `status` is normalized to `"success" | "pending" | "failed"`. Validation failures, a non-success SDK state, and thrown SDK errors all surface as a typed `SettleKitError` (`validation_error`, `unauthorized`, `payment_failed`, `integration_error`) — the last is marked `retryable`.

## Testing & demos

Inject `LocalAppKitSdk` — a deterministic, in-memory client that records calls and returns synthetic, monotonically-numbered tx hashes (no chain, no kit key, no network):

```ts
import { configureAppKit, LocalAppKitSdk } from "@settlekit/app-kit";

const sdk = new LocalAppKitSdk();             // or { state: "reverted" } / { throwOn: ["send"] }
const arc = configureAppKit({ sdk, kitKey: "kit_test" });
```

## Supported

- **Chains** — `Arc_Testnet`/`Arc_Mainnet`, `Ethereum(_Sepolia)`, `Base(_Sepolia)`, `Arbitrum(_Sepolia)`.
- **Tokens** — `USDC`, `EURC`, `USDT`, `USDe`, `DAI`, `PYUSD`, `cirBTC`.

## Environment

| Variable         | Purpose                                          |
| ---------------- | ------------------------------------------------ |
| `CIRCLE_KIT_KEY` | Circle kit key, required by Swap. Never logged.  |
