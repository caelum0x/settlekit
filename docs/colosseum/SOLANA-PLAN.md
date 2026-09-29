# SettleKit × Solana — Colosseum Crypto World's Fair plan (submit Oct 11, deadline Oct 12 2026)

Baseline: tag `pre-colosseum-baseline` = `7c6f6ce` (2026-06-22). Everything after is hackathon-window work.

## Repo findings (fix first)
1. Security hole: `apps/api/src/routes/payments.ts` `POST /:id/confirm` only verifies on-chain when `ctx.arcVerifier && payment.network === "arc"`; any other network confirms with an arbitrary txHash → entitlements granted. Must FAIL CLOSED per network.
2. Worker bug: `apps/worker/src/jobs/payment-confirm-job.ts` verifies with `to: ctx.config.arc.usdcAddress` (the USDC contract) instead of merchant payTo.
3. `apps/checkout/lib/store.ts` `recordAndConfirm` accepts any well-formed hash when Arc unconfigured. Solana must fail closed.
4. GitHub delivery is fake: `apps/checkout/lib/deliver.ts` `githubInviteAccess` only builds a URL. Real code exists: `@settlekit/github` `grantGitHubRepoAccess` + `createGitHubAccessClient(new OctokitGitHubApi(createGitHubAppClient(...)))`. Nothing enqueues delivery after payment.
5. Two confirm paths: checkout app (direct Postgres, `/api/v1/checkout-sessions/[id]/confirm`) for humans; API `/v1/payments/:id/confirm` for SDK/agents. Shared rules live in `packages/solana`.
6. `packages/x402` is a custom scheme (tx-hash proof) — keep for Arc, add spec-compliant SVM `exact` separately.
7. No DB migration needed (network is text; CheckoutSession stored as JSON doc).
8. Lockfile already has `@solana/kit@5.5.1`, `@x402/core@2.16.0`, `@x402/evm@2.16.0`.

## Libraries
- `@solana/kit@5.5.1` + `@solana-program/token` (NOT web3.js v1 / spl-token).
- Solana Pay: own ~120 LOC (encode URL, reference, findReference via getSignaturesForAddress) — not `@solana/pay`.
- Wallet: `@wallet-standard/app` getWallets() + `solana:signAndSendTransaction`; server builds tx.
- QR: `uqr` (zero-dep SVG).
- x402 SVM: `@x402/core` + `@x402/svm` + `@x402/hono` @2.16.x; `@x402/fetch` in agent script only.
- RPC: Helius (env), public fallback.
- DISK: ~7GB free. Filtered installs only: `pnpm install --filter "@settlekit/api..." --filter "@settlekit/checkout-app..." --filter "@settlekit/solana..."` etc. Never unfiltered root install. Stop if `df` < 3GB.

## packages/solana (@settlekit/solana) — mirror packages/arc (injectable RPC seam)
- `clusters.ts`: mainnet USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`; CAIP-2 mainnet `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`, devnet `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`.
- `rpc.ts`: SolanaRpc interface (getTransaction jsonParsed maxSupportedTransactionVersion 0, getSignaturesForAddress, getLatestBlockhash, sendTransaction, getSignatureStatuses) + `createKitSolanaRpc(url)`.
- `verify.ts` `verifySplTransfer({signature, mint, recipientOwner, minAmount, reference?, commitment})`: tx exists & meta.err null; Δ = Σpost − Σpre token balances where mint==usdc && owner==recipientOwner (bigint base units, 6 dp) ≥ minAmount; payer = owner whose USDC decreased; reference must be in accountKeys if given; ignore other mints.
- `pay-url.ts` Solana Pay transfer-request + transaction-request URL encode/parse.
- `reference.ts` random 32 bytes → base58.
- `find-reference.ts` oldest signature for reference or null.
- `tx-builder.ts` `buildUsdcPaymentTx` → base64 unsigned v0 tx: idempotent create recipient ATA + TransferChecked + reference readonly key; fee payer = buyer.
- `settlement-provider.ts` SolanaSettlementProvider (hot wallet; memo=reference; IdempotencyStore reserve/release). Add `"solana"` to `SettlementProviderName`; configure.ts accepts injected provider.
- `x402-verifier.ts` legacy PaymentVerifier adapter.
- Tests with fixtures for every module.

## End-to-end touchpoints
A. `PaymentNetwork = "solana" | "base" | "arc" | "ethereum"`; `CheckoutSession.paymentReference?`; X402Network += solana; checkout-sessions route NETWORKS += solana (base58 payTo validation, set paymentReference); observe schema network-dependent regexes; `tsc -b` fix all exhaustive switches.
B. API verifier registry `ctx.verifiers: Partial<Record<PaymentNetwork, PaymentVerifier>>` (arc existing; base via createArcClient + Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`; solana). Missing verifier → validation error (fail closed). txHash uniqueness (`findByTxHash` on PaymentRepository in-memory + persistence) → 409. Worker fix: verify against session payTo, route by network.
C. Checkout app: `lib/solana.ts`; `recordAndConfirm` dispatch by network; `confirmFromReference` idempotent; routes `api/v1/checkout-sessions/[sessionId]/solana/{pay-url,tx,status}`; network-aware TX_HASH_RE on confirm; REAL GitHub delivery `lib/github-delivery.ts` once after confirm + entitlement row via `@settlekit/entitlements` grantFromPayment; `components/SolanaPay.tsx` (QR + wallet-standard + polling + Solscan); page renders SolanaPay when network=solana; next.config transpilePackages.
D. x402 SVM (`apps/api/src/routes/x402-svm.ts`): `@x402/hono` paymentMiddleware + HTTPFacilitatorClient(X402_FACILITATOR_URL, PayAI `https://facilitator.payai.network` default) + SVM exact; `GET /v1/x402/research`, `POST /v1/x402/products/:productId/buy` → record Payment, grant entitlements, run delivery inline, return artifact. Agent client `apps/examples/src/agent-buy-solana.ts`.
E. Tests: verify/pay-url/find-reference/tx-builder/settlement; `apps/api/test/payments-solana.test.ts` (fail closed, duplicate txHash 409, base w/o verifier regression); `x402-svm.test.ts` fake facilitator; `apps/checkout/test/solana-confirm.test.ts`; worker tests. `scripts/solana-devnet-e2e.ts`.
F. Deploy: trim render.yaml to db/api/worker/web/checkout; filtered Dockerfile installs; env SOLANA_CLUSTER, SOLANA_RPC_URL, SOLANA_USDC_MINT, X402_FACILITATOR_URL, X402_SOLANA_PAY_TO, BASE_RPC_URL. `/proof` page on apps/web (confirmed solana payments, GMV, Solscan links). README Solana-first + disclosure.

## Priority
P0 checkout + verification + real GitHub delivery + mainnet sales. P1 x402 SVM agent buy. P2 Base verifier, payouts provider, dashboard polish.

## Scope cuts (hide, don't delete/move)
Ignore arc-* / circle-* apps, chainmail, recibo, refund-protocol, stream-meter, creator-dashboard, agent-console, admin, portal, marketplace, docs, skills, clis/lepton, sidecars, contracts, LEPTON*.md; packages lepton, erc8004*, erc8183*, cctp, gateway, stablefx, paymaster, wallet-fleet, circle-wallets, payouts-cpn, citation-toll, streaming, oss-fund, agent-economy.

## Disclosure (draft)
SettleKit's commerce core (catalog, checkout sessions, entitlements, delivery handlers, EVM/Arc USDC verification) pre-dates the hackathon; last pre-hackathon commit `7c6f6ce` (2026-06-22), tagged `pre-colosseum-baseline`. All work Sep 14–Oct 12 2026 is `git diff pre-colosseum-baseline..HEAD`: @settlekit/solana, Solana checkout UI, x402 SVM agent purchases, real on-payment GitHub delivery, fail-closed multi-network verifier, mainnet deployment, traction.
