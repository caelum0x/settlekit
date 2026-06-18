# @settlekit/x402-client

The client side of x402: fetch a resource, and if it answers `402 Payment Required`, settle the advertised challenge and retry with the proof attached.

- **`payAndFetch(url, { fetcher, settler, from, maxPriceUsdc })`** — the pay-and-retry loop. The transport is any `(Request) => Promise<Response>`, so it works over real HTTP or against an in-process `withSettleKitPayment` handler (a fully local closed loop).
- **`createLocalSettlement()`** — a matched settler + verifier over a shared in-memory ledger. The settler records a transfer and emits a proof; the verifier confirms it. Tracks volume and per-recipient totals for traction metrics.
- **`createCircleWalletSettler({ wallets, walletId, tokenId, fromAddress })`** — executes a real USDC transfer via Circle programmable wallets and returns the on-chain txHash as the proof. Use for genuine testnet-USDC volume.

```ts
import { createLocalSettlement, payAndFetch } from "@settlekit/x402-client";

const { settler, verify, ledger } = createLocalSettlement();
const result = await payAndFetch("https://api.example/resource", { fetcher, settler, from: "0xagent" });
// result.value.paid, result.value.proof, ledger.totalVolume()
```
