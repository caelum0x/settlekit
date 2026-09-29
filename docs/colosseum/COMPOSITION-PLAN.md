# SettleKit OSS composition plan (research 2026-09-29)

Goal: every Colosseum chain (Solana, Ethereum, Base, Arbitrum, Robinhood, Hyperliquid, Tempo, Zcash) with stablecoin checkout, any-token payment, subscriptions, agent payments, refunds and payouts. Built on MULTICHAIN-PLAN.md (chains/zcash/checkout UI already done). Facts verified live on 2026-09-29 (eth_call / eth_getCode / provider /chains and /supported endpoints).

## Licensing rules
- DO NOT use Reown AppKit or `@walletconnect/*` ≥2.25 (Reown Community License: paid above 500 MAU / 2.5M RPC per month, changes assigned to Reown). wagmi/RainbowKit/ConnectKit WalletConnect connectors pull these in. Keep EIP-6963 + `@wallet-standard/app`; mobile via QR (EIP-681 `ethereum:` URIs, Solana Pay).
- Unusable (GPL/AGPL): SHKeeper, Peanut SDK, @debridge-finance/dln-client, across-protocol/toolkit.
- Reference only (don't vendor): BTCPay, Bitcart (invoice state machines), Hyperswitch, Request Network, OnchainKit (archived), Superfluid (no HyperEVM/Tempo/Robinhood), Daimo Pay (hosted, no Tempo/Robinhood).

## Components to compose
| Package | OSS | License | Use |
|---|---|---|---|
| `@settlekit/routing` | Relay REST API (hand-written client, ~150 LOC; `@relayprotocol/relay-sdk` optional) + LI.FI (`@lifi/sdk`/REST) fallback | MIT / Apache-2.0 | Pay with any token on any chain → merchant receives stablecoin on session network. Relay/LI.FI `/chains` include 1, 8453, 42161, 999 HyperEVM, 1337 HyperCore, 4217 Tempo, 4663 Robinhood, Solana. Not Zcash. |
| `@settlekit/hyperliquid` | `@nktkas/hyperliquid` | MIT | HyperCore USDC `usdSend`/`spotSend` (EIP-712, any EVM wallet); verify via `info.userNonFundingLedgerUpdates` (hash, token, amount, destination). |
| `@settlekit/x402` upgrade + `@settlekit/x402-facilitator` | `@x402/core,evm,svm,hono,extensions@2.27` (x402-foundation/x402) | Apache-2.0 | exact (EIP-3009 / Permit2), upto, batch-settlement, auth-capture. Self-hosted facilitator for chains public facilitators don't list. |
| Tempo | `viem/tempo` (in viem ≥2.5x) + `mppx` (wevm) | MIT | `transferWithMemo(keccak256(sessionId))`, fee token; agent payments via MPP (`mppx/hono`, `mppx/tempo`). |
| `@settlekit/onchain-billing` | base/commerce-payments (audited, Base mainnet+Sepolia only) + Permit2 + `@base-org/account` | MIT / Apache-2.0 | Base: AuthCaptureEscrow v1.1 authorize/capture/void/refund, SpendPermission/PreApproval collectors for subscriptions. Other EVM EOAs: Permit2 AllowanceTransfer with cap + expiry, worker pulls per period. Solana: SPL approve to delegate. HyperCore/Zcash: renewal-invoice links. |
| payouts/treasury (optional) | `@circle-fin/bridge-kit` 1.15 | Apache-2.0 | USDC CCTP v2 moves (Eth, Base, Arb, HyperEVM, Solana, Arc; not Tempo/Robinhood). Overlaps existing @settlekit/cctp. |
| Zcash shielded (stretch) | zcash/zcash-devtool (UFVK sidecar) / WebZjs | Apache/MIT | Roadmap: WebZjs browser-only + unaudited. Keep transparent ZEC. |

Verified facts:
- x402 facilitators (`/supported`): PayAI (no key) = Solana mainnet+devnet (exact+batch), Base (exact+batch), Arbitrum 42161/421614. x402.org = testnets only. x402.rs includes HyperEVM testnet 998. None list Ethereum mainnet, HyperEVM 999, Robinhood 4663, Tempo 4217 → self-facilitate those.
- Token probes: HyperEVM USDC EIP-3009 yes, EIP-712 domain `USDC`/`"2"`. Robinhood USDG EIP-3009 + EIP-2612, domain `Global Dollar`/`"1"` (`version()` reverts). Tempo USDC.e/pathUSD: no EIP-3009, EIP-2612 nonces yes. Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3` deployed on all 6 EVM chains.
- Base Account SpendPermissionManager deployed on Ethereum, Base, Arbitrum, Robinhood (not HyperEVM/Tempo); smart-wallet users only.
- Existing `apps/checkout/lib/bridge-pay.ts` uses `LocalAppKitSdk` — an offline simulation. Replace with real routing.

## Rules
- Fulfilment NEVER trusts a route provider's status: the destination fill must pass the fail-closed `@settlekit/chains` / `@settlekit/solana` / hyperliquid verifier (Transfer to payTo, amount ≥ expected, after createdAt, unique hash). Provider requestId stored for UX/refunds only.
- Self-facilitator relayer: per-network enable list, gas budget guard, spend caps, kill switch.
- Honest labels in UI/README: Y / S (self-facilitated) / P (pull-based) / I (renewal invoice) / E (experimental) / N.

## Capability matrix (target)
| Chain | Stablecoin | Any token | Subscriptions | Agent payments | Refunds | Payouts |
|---|---|---|---|---|---|---|
| Solana | Y USDC | Y Relay | P SPL delegate; I | Y PayAI | Y send-back | Y |
| Ethereum | Y USDC | Y | P Permit2; spend permission | S | Y | Y |
| Base | Y USDC | Y | Y commerce-payments; P | Y PayAI/CDP; auth-capture E | Y escrow refund | Y |
| Arbitrum | Y USDC | Y | P | Y PayAI | Y | Y |
| Robinhood | Y USDG (testnet Mock USDC) | Y | P | S (USDG 3009 v"1") | Y | Y |
| HyperEVM | Y USDC | Y | P Permit2 | S (USDC 3009 v"2") | Y | Y |
| HyperCore | Y USDC usdSend | Y Relay 1337 | I | N | Y usdSend | Y |
| Tempo | Y USDC.e / pathUSD + memo | Y Relay 4217 | P (E); I | Y MPP (mppx); x402 Permit2 E | Y | Y |
| Zcash | ZEC transparent | N | I | N | Manual | Manual |

## Waves
- W1 routing: `packages/routing` (provider.ts, relay.ts EXACT_OUTPUT quote + status + deposit address, lifi.ts, policy.ts max fee bps/slippage/origin allowlist/quote TTL, destination.ts network → chain id + token). Checkout `lib/any-token.ts`, routes `[sessionId]/route/{quote,status}`, `components/AnyTokenPay.tsx` replaces BridgePay mock. Session `route?: {provider, requestId, originChainId, originTxHash, quotedAt}`. Worker `jobs/route-watch.ts` → destination verifier. Tests with recorded Relay/LI.FI fixtures incl. "provider success but no destination Transfer → unpaid".
- W2 HyperCore + Tempo: `packages/hyperliquid` (typed-data, submit, verify via ledger, env); `hypercore` PaymentNetwork + tsc fixes; `HyperCorePay.tsx`; Tempo memo enforcement. Golden EIP-712 vectors + ledger fixtures.
- W3 agent payments: upgrade `@x402/*` to 2.27; `packages/x402-facilitator` (assets, verify/settle with relayer key, enable list, gas guard, supported); API `routes/x402-evm.ts` (local facilitator for S networks, PayAI otherwise), `routes/mpp-tempo.ts` (mppx/hono); examples `agent-buy-{evm,tempo}.ts`. Tests: signed fixtures (bad sig, expired, wrong asset, replayed nonce), fake facilitator, mppx round-trip.
- W4 onchain billing: `packages/onchain-billing` (permit2-allowance, spend-permission, commerce-escrow, spl-delegate, renewal-invoice); worker `jobs/subscription-charge.ts` idempotent per period + dunning; refunds wired per network. Tests: injected RPC unit tests, period math, double-charge idempotency, optional anvil Base fork (skipped without RPC).
- W5 proof: small live mainnet payment per chain, one Relay cross-chain, x402 on Solana/Base + MPP on Tempo, one Base subscription; `/proof` page; README matrix.

## Risks
Self-facilitation hot key; Tempo TIP-20 lacks EIP-3009 and TIP-403 policies can revert; Robinhood only USDG, pin addresses, Relay liquidity incident 2026-07-07; HyperCore vs HyperEVM separate balances; route slippage/bridge failure (refundTo); commerce-payments audited on Base only; Zcash shielded out of scope; any-token routing effectively mainnet-only (demo with small amounts); keep checkout bundle lean (no @lifi/widget, no wagmi+RainbowKit), lazy-load per-network components.

Sources: github.com/x402-foundation/x402 · facilitator.payai.network/supported · x402.org/facilitator/supported · facilitator.x402.rs/supported · github.com/base/commerce-payments · docs.relay.link/references/api/get-quote · api.relay.link/chains · li.quest/v1/chains · github.com/nktkas/hyperliquid · github.com/wevm/mppx · github.com/base/account-sdk · github.com/reown-com/appkit/blob/main/LICENSE.md · github.com/zcash/zcash-devtool · github.com/ZcashCommunityGrants/WebZjs
