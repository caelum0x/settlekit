# SettleKit: Colosseum Crypto World's Fair submission

Hackathon window: 2026-09-14 to 2026-10-12. Tracks: Solana, Ethereum, Base, Arbitrum, Hyperliquid, Tempo, Zcash, Robinhood Chain.
Branch: `feat/solana-colosseum`. Baseline tag: `pre-colosseum-baseline` (`7c6f6ce`). See [Disclosure](#disclosure) for exactly what was built in the window.

Related: [PITCH-SCRIPT.md](./PITCH-SCRIPT.md) · [DEMO-SCRIPT.md](./DEMO-SCRIPT.md) · [LAUNCH-CHECKLIST.md](./LAUNCH-CHECKLIST.md) · plans: [SOLANA-PLAN.md](./SOLANA-PLAN.md), [MULTICHAIN-PLAN.md](./MULTICHAIN-PLAN.md), [COMPOSITION-PLAN.md](./COMPOSITION-PLAN.md)

---

## One-liner

SettleKit lets software sellers get paid in stablecoins on any chain, by humans or AI agents, and delivers access (GitHub repos, SaaS plans, license keys, Discord roles, API keys, files) automatically the moment the payment is verified on-chain.

## Problem

Founders, small teams and app studios selling software depend on merchants of record (MoRs) and card processors to get paid. Those gatekeepers reject whole categories of sellers: AI products, developer tools, businesses outside the US/EU, anything that looks "high risk". A rejection has no appeal and ends the business's ability to charge.

Stablecoins solve the money movement, but a seller who just posts a wallet address still has no checkout, no way to know which transfer belongs to which order, no subscriptions, no refunds, and no access delivery. Every buyer becomes a manual reconciliation job. And buyers hold funds on many chains (Solana, Base, Ethereum, Arbitrum, Hyperliquid, Tempo, Robinhood Chain, Zcash), so a single-chain checkout loses most of them.

A third buyer type is arriving: AI agents that need to buy API access and tools programmatically, with no human and no card.

## Solution

One payment link per product. The buyer picks the chain and token they already hold; SettleKit verifies the transfer on-chain, fail closed, and runs the product's delivery actions.

- **Pay on the chain you use**: USDC on Solana, Ethereum, Base, Arbitrum, HyperEVM; USDC `usdSend` on HyperCore; USDG on Robinhood Chain; USDC.e on Tempo; transparent ZEC on Zcash at a locked USD quote.
- **Pay with any token**: the buyer pays with whatever they hold on another chain; Relay (LI.FI fallback) routes it, and the merchant receives the stablecoin on the session's network. Access is granted only after SettleKit sees the destination transfer itself.
- **AI agents buy directly**: x402 v2 on Solana and every EVM chain, MPP on Tempo. The agent gets the delivered artifact (repo invite, license key, API key) in the HTTP response.
- **Subscriptions on-chain**: Permit2 allowances on EVM, Base spend permissions and commerce-payments escrow, SPL delegate on Solana, renewal invoices on HyperCore and Zcash. The worker charges each period idempotently.
- **Refunds that send funds**: operator refunds dispatched per network from the dashboard.
- **Automatic delivery**: GitHub repo access via a GitHub App, Discord paid roles (Connect Discord at checkout), license keys, API keys, signed downloads, SaaS entitlements checkable by email, signed seller webhooks.
- **Public proof**: `/proof` lists every confirmed payment with explorer links, mainnet and testnet separated.

## Why now

- MoRs are tightening, not loosening: AI and developer-tool sellers are being refused (our own products were).
- Stablecoin supply and payment rails are live on every chain in this hackathon, but each chain has different tokens (USDC, USDG, USDC.e), different transfer semantics (HyperCore `usdSend`, Tempo `transferWithMemo`, Zcash transparent outputs) and different finality. Nobody unifies them for software sellers.
- Cross-chain routing (Relay, LI.FI) now supports HyperCore (1337), Tempo (4217) and Robinhood Chain (4663), so "pay with any token" is possible for the first time across all of these.
- Agent payments have standards: x402 v2 (x402-foundation) and MPP (Tempo). Agents need a seller-side stack that verifies, records, and delivers.

---

## What's built

### Feature matrix by chain

Labels are honest and match the checkout UI. **Mainnet proof** stays "pending" until a real mainnet transaction on that network appears on `/proof`; until then a network is presented as testnet-verified only.

| Network | Asset | Checkout | Any token (Relay/LI.FI) | Agent payments | Subscriptions | Refunds | Label | Mainnet proof |
|---|---|---|---|---|---|---|---|---|
| Solana | USDC | Solana Pay QR + Wallet Standard, reference-bound | Yes | x402 SVM via PayAI facilitator | SPL delegate | Yes | | pending |
| Ethereum | USDC | EIP-6963 wallets, EIP-681 QR, 12 conf. | Yes | x402 via self-hosted facilitator | Permit2 allowance | Yes | | pending |
| Base | USDC | EIP-6963 wallets, 3 conf. | Yes | x402 via PayAI | Spend permissions, commerce-payments escrow (authorize/capture/void/refund), Permit2 | Yes (incl. escrow refund) | | pending |
| Arbitrum | USDC | EIP-6963 wallets, 3 conf. | Yes | x402 via PayAI | Permit2 allowance | Yes | | pending |
| Robinhood Chain | USDG (Paxos) mainnet; Mock USDC testnet | EIP-6963 wallets, 3 conf. | Yes | x402 via self-hosted facilitator (USDG EIP-3009) | Permit2 allowance | Yes | USDG, no native USDC | pending |
| Hyperliquid: HyperEVM | USDC (ERC-20) | EIP-6963 wallets, 1 conf. | Yes | x402 via self-hosted facilitator | Permit2 allowance | Yes | HyperEVM | pending |
| Hyperliquid: HyperCore | USDC via `usdSend` (EIP-712, any EVM wallet) | Signed `usdSend`, verified via ledger updates | Yes (Relay 1337) | No | Renewal invoice | Yes (`usdSend` back) | HyperCore, separate balance from HyperEVM | pending |
| Tempo | USDC.e (Stargate-bridged) mainnet; pathUSD testnet | `transferWithMemo(keccak256(sessionId))`, 1 conf. | Yes (Relay 4217) | MPP via `mppx` | Permit2 (experimental); renewal invoice | Yes | Bridged | pending |
| Zcash | ZEC at locked USD quote | ZIP-321 QR, unique zatoshi tag, Blockchair verification | No | No | Renewal invoice | Manual | Transparent only, mainnet only | pending |
| Arc | USDC | Pre-existing (baseline) | No | Pre-existing custom x402 | No | No | Testnet only | n/a |

Notes:
- **HyperCore vs HyperEVM**: these are two different balances on Hyperliquid. HyperEVM is an EVM chain (ERC-20 USDC transfer); HyperCore payments are `usdSend` actions verified through `info.userNonFundingLedgerUpdates`. The picker lists them separately.
- **Tempo** settles USDC.e, which is bridged via Stargate, not native USDC. TIP-403 policies can reject transfers; the checkout says so.
- **Zcash** is transparent t-addresses only: amount and addresses are public. No testnet support (Blockchair covers mainnet only). Shielded payments are roadmap.
- **Robinhood Chain** mainnet has no native USDC; SettleKit settles USDG. Addresses are pinned in `@settlekit/chains`.
- L2 sequencer soft finality on Base, Arbitrum and Robinhood Chain is disclosed in `apps/checkout/README.md`.

### Seller surfaces

- Guided onboarding in the dashboard: "Where you get paid" (payout address per network) → "Your first product" → "Share your link".
- Products with reusable payment links (`/l/[slug]`), accepted networks per product, balances, payments, subscriptions, refunds that send funds, webhook endpoints with signing secrets.
- SaaS integration guide at `/docs/integrate` with email-based entitlement checks.
- Render blueprint for api, worker, checkout, dashboard, web.

### Buyer surfaces

- Hosted checkout `/c/[sessionId]` with a network picker, per-network flows (Solana Pay, EVM wallet, HyperCore `usdSend`, Tempo memo, Zcash QR, any-token route), receipts with delivered access.
- Subscription management via signed link `/s/[token]` (status, next charge, cancel and revoke).
- Agent scripts: `apps/examples/src/agent-buy-{solana,evm,tempo}.ts`.

---

## Architecture

```mermaid
flowchart LR
  subgraph Buyers
    H[Human buyer<br/>wallet on any chain]
    A[AI agent<br/>x402 / MPP client]
  end

  subgraph SettleKit
    W[apps/web<br/>landing, /proof, /docs/integrate]
    D[apps/dashboard<br/>onboarding, products, refunds]
    C[apps/checkout<br/>/l/slug, /c/session, /s/token]
    API[apps/api<br/>/v1 REST, x402, MPP, onchain-billing]
    WK[apps/worker<br/>verification, route-watch,<br/>zcash-watch, subscription-charge,<br/>delivery retries, webhooks]
    DB[(Postgres<br/>@settlekit/persistence)]
  end

  subgraph Verification["Fail-closed verifiers"]
    CH["@settlekit/chains<br/>EVM: Ethereum, Base, Arbitrum,<br/>Robinhood, HyperEVM, Tempo, Arc"]
    SO["@settlekit/solana"]
    HL["@settlekit/hyperliquid<br/>HyperCore ledger"]
    ZC["@settlekit/zcash<br/>Blockchair + quote lock"]
  end

  subgraph Composed["Composed OSS / services"]
    RT["@settlekit/routing<br/>Relay REST, LI.FI fallback"]
    XF["@settlekit/x402-facilitator<br/>@x402/* 2.27"]
    PAI[PayAI facilitator]
    MPP[mppx on Tempo]
    OB["@settlekit/onchain-billing<br/>Permit2, spend permissions,<br/>commerce-payments, SPL delegate"]
  end

  subgraph Delivery
    GH[GitHub App repo access]
    DC[Discord paid role]
    LK[License / API keys, files]
    WH[Signed seller webhooks]
  end

  H --> C
  A --> API
  D --> API
  W --> API
  C --> DB
  API --> DB
  WK --> DB
  C --> RT
  API --> XF
  API --> PAI
  API --> MPP
  API --> OB
  WK --> OB
  C & API & WK --> CH & SO & HL & ZC
  API & WK & C --> GH & DC & LK & WH
```

Flow: session created → buyer picks network → transfer sent (directly, or routed from another chain) → verifier checks the destination transfer (token, recipient, amount, block time, confirmations, unique hash, payer/memo binding) → payment confirmed → entitlements granted → delivery actions run → seller webhook signed and sent → payment appears on `/proof`.

---

## Open source composed

| Component | License | Used for |
|---|---|---|
| x402-foundation `@x402/core`, `@x402/evm`, `@x402/svm`, `@x402/hono`, `@x402/extensions` 2.27 | Apache-2.0 | x402 v2 agent payments; basis of the self-hosted facilitator |
| Relay REST API (hand-written client) + LI.FI REST fallback | API terms / Apache-2.0 SDK | Any-token cross-chain routing into the session's stablecoin |
| `@nktkas/hyperliquid` | MIT | HyperCore `usdSend` typed data, submission, ledger verification |
| `mppx` (wevm) | MIT | MPP agent payments on Tempo |
| base/commerce-payments, Uniswap Permit2, Base spend permissions | MIT | Onchain subscriptions, Base escrow authorize/capture/void/refund |
| viem (incl. `viem/tempo`) | MIT | EVM RPC, typed data, signature verification (ECDSA, EIP-1271/6492) |
| `@solana/kit`, `@solana-program/token` | MIT / Apache-2.0 | Solana transaction building and verification |
| `@wallet-standard/app`, EIP-6963 | Apache-2.0 / standard | Wallet discovery without a wallet SDK |
| `uqr` | MIT | Zero-dependency QR (Solana Pay, EIP-681, ZIP-321) |

**Deliberately avoided**: Reown AppKit and `@walletconnect/*` 2.25+ are under the Reown Community License (paid above 500 MAU or 2.5M RPC requests per month, and contributions are assigned to Reown). wagmi/RainbowKit/ConnectKit connectors pull them in. SettleKit uses EIP-6963 + Wallet Standard in the browser and QR payment URIs (EIP-681, Solana Pay, ZIP-321) for mobile, so the checkout stays fully open source with no MAU cap. GPL/AGPL projects (SHKeeper, Peanut SDK, deBridge DLN client, Across toolkit) were excluded for license compatibility; BTCPay, Bitcart, Request Network and Daimo Pay were used as references only.

---

## Security model

- **Fail closed per network.** A network is offered only if the seller accepted it and the deployment has a verifier for it. A confirm on a network without a verifier is rejected; it can never grant access. (Pre-window code confirmed non-Arc payments with any tx hash; this was the first fix in the window.)
- **Verifier rules (EVM)**: RPC chain id must equal the registry id; receipt success; `Transfer` from the pinned token contract to the session's `payTo`; amount ≥ expected; confirmations ≥ network minimum; block time ≥ session creation minus skew; Tempo memo = `keccak256(sessionId)`.
- **One payment per transaction**: a partial unique index on the on-chain hash; races map to HTTP 409.
- **Destination-verified routing**: Relay/LI.FI status is never trusted. Access is granted only after SettleKit's own verifier sees the transfer land in the seller's wallet on the session network. "Provider says success, no destination transfer" stays unpaid.
- **Signed payer binding**: the EVM wallet flow binds the payer only with a short-lived `personal_sign` message naming session, network and payer, verified locally (ECDSA) or via RPC (EIP-1271/6492 smart wallets). Solana binds via a Solana Pay reference key; Zcash via a unique zatoshi amount tag assigned atomically per `payTo`.
- **Tenant isolation**: single-resource routes enforce org ownership; refunds, disputes, dunning, invoices, license keys, coupons and entitlement lists are scoped to the caller's org; onchain-billing reads are org-scoped.
- **x402 facilitator guardrails**: closed-by-default recipient allowlist (defaults to the deployment's own recipients), exact authorization value required, Postgres nonce store against replay, per-network enable list, max amount, gas price cap and daily gas budget, kill switch.
- **Checkout CSRF**: state-changing routes reject cross-site requests (`Origin` / `Sec-Fetch-Site`), except the Solana Pay transaction request.
- **Signed webhooks** to sellers; signed subscription-management links; secrets only from env (Render `generateValue` / `sync: false`).
- **Known limits, disclosed**: L2 soft finality; pasted-hash path is first-claim-wins (mitigated by uniqueness, block time and payer binding); the facilitator relayer is a hot key; Zcash depends on Blockchair.

---

## Business model

- **1% per successful payment, no fixed fee, no monthly fee.** The single source of truth is `DEFAULT_FEE_SCHEDULE = { bps: 100, fixed: "0" }` in `packages/platform-billing/src/fees.ts`; the API reads it (overridable by `PLATFORM_FEE_BPS` / `PLATFORM_FEE_FIXED`), and the landing page mirrors it via `NEXT_PUBLIC_PLATFORM_FEE_*`.
- Optional route app fee on cross-chain payments (`ROUTE_APP_FEE_BPS`), off by default.
- Open source and self-hostable; the hosted version is the paid convenience.
- Compare: MoRs charge roughly 5% + fixed fees, and only if they accept you.

## Go-to-market

1. **Dogfood first**: the founder's own products (Menivor AI video, Scribase Postgres backend, Rally GTM) are sold through SettleKit. They are the first sellers, the first `/proof` entries, and the integration test for SaaS entitlement checks by email.
2. **Software sellers rejected by MoRs**: the people with the sharpest pain. Channels:
   - Direct outreach to founders who publicly posted MoR rejections (X, Reddit r/SaaS and r/Entrepreneur, Hacker News threads, Lemon Squeezy / Paddle / Creem rejection discussions).
   - "Accept stablecoins in 5 minutes" integration guide (`/docs/integrate`) and a GitHub template per stack (Next.js SaaS, private-repo sale, license-key app).
   - Private GitHub repo sellers (templates, boilerplates, courses-as-repos): delivery via GitHub App is the hook.
   - Discord-community sellers: paid roles delivered automatically.
3. **Agent-commerce sellers via x402 / MPP**: API and tool builders who want AI agents as buyers.
   - Listings in x402 ecosystem directories and facilitator partner pages (PayAI), Tempo/MPP ecosystem.
   - Example agent scripts and an MCP-friendly `GET /v1/x402/networks` discovery endpoint.
4. **Chain ecosystems**: each chain in the fair gets a native story (Solana Pay, HyperCore `usdSend`, Tempo memos, Robinhood USDG, Zcash ZIP-321); ecosystem newsletters, grants and hackathon showcases.

## Traction (fill in before submitting)

All numbers come from `GET /v1/public/proof` (rendered at `/proof`). Demo and test orgs are excluded via `PROOF_EXCLUDED_ORGS`. Never mix testnet into mainnet numbers.

| Metric (source field) | Value | As of |
|---|---|---|
| Mainnet confirmed payments (`mainnet.count`) | ___ | ____ |
| Mainnet volume, USD (`mainnet.volumeUsd`) | $___ | ____ |
| Testnet payments (`testnet.count`), labelled testnet | ___ | ____ |
| AI agent purchases, x402 + MPP (`agentPurchases`) | ___ | ____ |
| Networks with at least one mainnet payment (`totals[] where env = mainnet`) | ___ / 9 | ____ |
| Per network: count and volume (`totals[]`) | see table below | ____ |
| Sellers onboarded (dashboard orgs, excluding demo) | ___ | ____ |
| Products live with payment links | ___ | ____ |
| Active onchain subscriptions | ___ | ____ |
| Founder's own products selling through SettleKit (Menivor / Scribase / Rally) | ___ / 3 | ____ |
| Waitlist / inbound seller conversations | ___ | ____ |

| Network | Env | Payments | Volume (USD) | Example tx (explorer link) |
|---|---|---|---|---|
| Solana | mainnet | | | |
| Ethereum | mainnet | | | |
| Base | mainnet | | | |
| Arbitrum | mainnet | | | |
| Robinhood Chain (USDG) | mainnet | | | |
| HyperEVM | mainnet | | | |
| HyperCore | mainnet | | | |
| Tempo (USDC.e) | mainnet | | | |
| Zcash (transparent) | mainnet | | | |

## Team and founder-market fit

- Solo founder shipping a portfolio of software products: Menivor (AI video), Scribase (Postgres backend built on Supabase and Neon), Rally (GTM automation).
- The founder hit the exact problem SettleKit solves: merchants of record, including Creem, rejected these products, leaving no way to charge customers. SettleKit is built from that experience and is used by the founder first.
- Prior work: SettleKit's commerce core (catalog, checkout sessions, entitlements, delivery engine, Arc/EVM USDC verification) was built before the window, so the hackathon time went into the hard multi-chain, agent and billing parts.

## Roadmap

- **Shielded Zcash**: unified address + UFVK viewing-key sidecar (zcash-devtool) to detect shielded payments with memos; ZSA stablecoins once NU7 ships.
- **More chains and assets**: EURC, additional Solana stablecoins (USDG, PYUSD), more EVM L2s from the same registry, x402 on Tempo via Permit2 once stable.
- **Payouts and treasury**: CCTP v2 / Bridge Kit to consolidate balances across chains.
- **Shielded and private checkout options**, merchant-side tax/invoice exports, and marketplace discovery for agent-purchasable products.
- **Hosted facilitator hardening**: KMS-held relayer keys, per-seller gas budgets.

---

## Disclosure

**Baseline**: tag `pre-colosseum-baseline` = commit `7c6f6ce` (2026-06-22). Everything reachable from that tag pre-dates the hackathon and is not submitted as hackathon work. That includes:

- The SettleKit commerce core: product catalog, prices, checkout sessions, payments model, entitlements engine, delivery runner and handlers (GitHub, Discord, license keys, API keys, files, SaaS), webhooks, dashboard shell, marketing site, SDKs and CLIs.
- Arc (Circle testnet) USDC settlement and the original EVM verification client in `packages/arc`, and the custom tx-hash x402 scheme in `packages/x402`.
- Modules from an earlier hackathon entry (Lepton / Arc / Circle apps and packages: `LEPTON*.md`, `apps/arc-*`, `apps/circle-*`, `apps/creator-dashboard`, `apps/agent-console`, `clis/lepton`, `packages/erc8004*`, `packages/erc8183*`, `packages/cctp`, `packages/gateway`, `packages/stablefx`, `packages/paymaster` and similar). These are pre-existing and out of scope for judging.

**In-window work** is exactly `git diff pre-colosseum-baseline..HEAD` on `feat/solana-colosseum`. Computed at HEAD `33baad0`:

- **79 commits**, all by the founder (`caelum0x`).
- **528 files changed, 46,407 insertions, 1,946 deletions** in total. Excluding `pnpm-lock.yaml` and test files: **403 files, 32,466 insertions, 1,758 deletions**. Tests alone: **124 files, 12,883 insertions**.

New packages (did not exist at the baseline):

| Package | Purpose | Commits | Files | Insertions |
|---|---|---|---|---|
| `packages/solana` | Solana USDC verification, Solana Pay, tx builder, reference binding | 1 | 20 | 2,121 |
| `packages/chains` | Multi-chain registry, fail-closed EVM verifier, CAIP, tx-hash/address validation | 5 | 29 | 2,165 |
| `packages/zcash` | Transparent ZEC: quote lock, ZIP-321, amount tags, Blockchair verification | 4 | 25 | 1,505 |
| `packages/routing` | Any-token routing via Relay with LI.FI fallback, route policy | 2 | 40 | 2,191 |
| `packages/hyperliquid` | HyperCore `usdSend` typed data, submission, ledger verification | 4 | 15 | 1,338 |
| `packages/x402-facilitator` | Self-hosted x402 facilitator with guardrails and Postgres nonce store | 5 | 15 | 1,919 |
| `packages/onchain-billing` | Onchain subscriptions, Base escrow, per-network refunds | 4 | 36 | 5,808 |

Existing packages and apps changed in the window:

| Path | Commits | Files | Insertions | Deletions |
|---|---|---|---|---|
| `apps/checkout` | 23 | 104 | 11,987 | 397 |
| `apps/api` | 33 | 77 | 7,226 | 391 |
| `apps/dashboard` | 5 | 37 | 2,692 | 605 |
| `apps/worker` | 15 | 31 | 2,534 | 60 |
| `apps/web` | 4 | 15 | 1,017 | 136 |
| `apps/examples` | 4 | 7 | 238 | 3 |
| `packages/persistence` | 8 | 11 | 519 | 0 |
| `packages/x402-client` | 3 | 5 | 253 | 1 |
| `packages/x402` | 3 | 9 | 246 | 3 |
| `packages/database` | 6 | 12 | 220 | 1 |
| `packages/arc` | 1 | 4 | 108 | 24 |
| `scripts/solana-devnet-e2e.ts` | 1 | 1 | 130 | 0 |
| `render.yaml` | 3 | 1 | 492 | 133 |
| `.env.example` | 9 | 1 | 122 | 1 |

(Commit counts per path overlap because one commit can touch several paths. Reproduce with `git log --oneline pre-colosseum-baseline..HEAD -- <path> | wc -l` and `git diff --shortstat pre-colosseum-baseline..HEAD -- <path>`.)
