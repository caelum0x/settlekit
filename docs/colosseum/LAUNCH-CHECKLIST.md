# SettleKit launch checklist (Colosseum, submit by Oct 11, deadline Oct 12 2026)

Ordered owner steps to go from branch to live mainnet payments and a submitted entry. Every chain and integration fails closed until configured, so anything skipped simply stays off. Variable reference: `.env.example`; service layout: `render.yaml`.

## 1. Push the code

- [ ] `git push -u origin feat/solana-colosseum` (repo `github.com/caelum0x/settlekit`).
- [ ] Push the baseline tag so judges can reproduce the disclosure: `git push origin pre-colosseum-baseline`.
- [ ] Decide whether Render deploys from `feat/solana-colosseum` or from a merge into `main`; set that branch in the Blueprint.

## 2. Create the Render Blueprint

- [ ] Render → New → Blueprint → connect the repo → select `render.yaml`. This creates `settlekit-db` (Postgres), `settlekit-api` (Docker, free), `settlekit-worker` (Docker, starter ~$7/mo; there is no free worker plan), `settlekit-checkout`, `settlekit-dashboard`, `settlekit-web`.
- [ ] Never create a plain Web Service on the repo root; always use the Blueprint.
- [ ] Note that free Render web services sleep when idle (first request ~60 s). For the demo recording and judging week, consider the starter plan for `settlekit-api` and `settlekit-checkout`.

## 3. Wallets and keys (create before filling env)

Use fresh keys for hot roles; fund them with gas only.

- [ ] Seller receiving addresses for the founder's org: EVM address (all EVM chains and HyperCore), Solana address, Zcash transparent t1 address.
- [ ] `X402_RELAYER_PRIVATE_KEY`: new EVM key, small gas balance on Ethereum, HyperEVM and Robinhood Chain (self-facilitated x402 networks).
- [ ] `ONCHAIN_BILLING_OPERATOR_PRIVATE_KEY`: new EVM key used for subscription pulls, Base escrow capture and EVM refunds; gas on Base plus each billing network.
- [ ] `ONCHAIN_BILLING_SOLANA_SECRET`: new Solana keypair (SPL delegate and Solana refunds); a little SOL.
- [ ] `HYPERCORE_REFUND_PRIVATE_KEY` (optional; defaults to the operator key).
- [ ] `MPP_SECRET_KEY`: `openssl rand -base64 32`; `MPP_TEMPO_RECIPIENT`: seller EVM address on Tempo.
- [ ] Solana RPC with a key (Helius or similar) for `SOLANA_RPC_URL`; own HyperEVM RPC if possible (public is 100 req/min/IP).
- [ ] Relay API key (`RELAY_API_KEY`); optional LI.FI key and integrator name.
- [ ] Optional Blockchair key (`BLOCKCHAIR_API_KEY`; keyless is 1000 calls/day).
- [ ] GitHub App: create it, give it repository administration (collaborators) permission, install it on the org that holds the private repos; note App ID, private key, installation ID.
- [ ] Discord: bot token, OAuth app client id/secret, redirect `<CHECKOUT_PUBLIC_URL>/api/discord/callback`.
- [ ] Resend API key and a verified `EMAIL_FROM` domain.

## 4. Environment variables per service

Generated automatically by the Blueprint: `LICENSE_TOKEN_SECRET`, `WEBHOOK_SIGNING_SECRET`, `AUTH_COOKIE_SECRET`, `FILE_DOWNLOAD_SECRET`, `API_BOOTSTRAP_KEY`, `SETTLEKIT_SERVICE_TOKEN` (api; copied to worker/checkout), `CHECKOUT_MANAGE_SECRET`, `CHECKOUT_DELIVERY_SECRET` (checkout). `DATABASE_URL` is wired from `settlekit-db`. Fee is preset to `PLATFORM_FEE_BPS=100`, `PLATFORM_FEE_FIXED=0` (api) and `NEXT_PUBLIC_PLATFORM_FEE_*` (web); keep them equal.

### settlekit-api
- [ ] Chains (same values on api, worker, checkout): `SETTLEKIT_CHAIN_ENV=mainnet`, `ENABLED_EVM_CHAINS=ethereum,base,arbitrum,robinhood,hyperevm,tempo`, optional `<KEY>_RPC_URL` / `<KEY>_NETWORK` / `<KEY>_MIN_CONFIRMATIONS` for ETHEREUM, BASE, ARBITRUM, ROBINHOOD, HYPEREVM, TEMPO.
- [ ] Solana: `SOLANA_CLUSTER=mainnet`, `SOLANA_RPC_URL`, leave `SOLANA_USDC_MINT` unset (registry default) unless overriding.
- [ ] Zcash: `ZCASH_ENABLED=true`, optional `ZCASH_EXPLORER_URL`, `BLOCKCHAIR_API_KEY`, `ZCASH_MIN_CONFIRMATIONS=3`, `ZCASH_QUOTE_TTL_SEC=900`.
- [ ] HyperCore: `HYPERCORE_ENABLED=true`, `HYPERCORE_NETWORK=mainnet`, optional `HYPERCORE_API_URL`.
- [ ] Routing: `ROUTING_ENABLED=true`, `RELAY_API_KEY`, optional `RELAY_API_URL`, `LIFI_ENABLED`, `LIFI_API_KEY`, `LIFI_INTEGRATOR`, `ROUTE_MAX_FEE_BPS`, `ROUTE_MAX_SLIPPAGE_BPS`, `ROUTE_QUOTE_TTL_SEC`, `ROUTE_ORIGIN_ALLOWLIST`, `ROUTE_APP_FEE_BPS`, `ROUTE_APP_FEE_RECIPIENT`.
- [ ] x402: `X402_PAY_TO`, `X402_EVM_PAY_TO`, `X402_SOLANA_PAY_TO`, `X402_NETWORKS=solana,base,arbitrum,ethereum,hyperevm,robinhood`, `X402_REMOTE_FACILITATOR_URL=https://facilitator.payai.network`, optional `X402_REMOTE_FACILITATOR_API_KEY`, `X402_RESEARCH_PRICE`.
- [ ] Self-hosted facilitator: `X402_RELAYER_PRIVATE_KEY`, `X402_FACILITATOR_NETWORKS`, `X402_FACILITATOR_MAX_AMOUNT`, `X402_FACILITATOR_ALLOWED_PAY_TO` (defaults to the deployment's own recipients), `X402_FACILITATOR_TOKEN`, `X402_FACILITATOR_KILL` (kill switch), `X402_FACILITATOR_ALLOW_EXPERIMENTAL`, `X402_GAS_MAX_FEE_ETHEREUM`, `X402_GAS_DAILY_BUDGET_ETHEREUM`.
- [ ] MPP: `MPP_SECRET_KEY`, `MPP_TEMPO_RECIPIENT`.
- [ ] Onchain billing: `ONCHAIN_BILLING_OPERATOR_PRIVATE_KEY`, `ONCHAIN_BILLING_SOLANA_SECRET`, `ONCHAIN_BILLING_NETWORKS` (default every enabled network), `ONCHAIN_BILLING_ESCROW` (set `off` to disable Base escrow), `ONCHAIN_BILLING_CHECKOUT_URL` (checkout URL), `HYPERCORE_REFUND_PRIVATE_KEY`.
- [ ] Delivery: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`, `DISCORD_BOT_TOKEN`, `RESEND_API_KEY`, `EMAIL_FROM`, `FILE_DOWNLOAD_BASE_URL`.
- [ ] Proof: `PROOF_EXCLUDED_ORGS` = comma list of demo/test org ids.
- [ ] Arc stays on its testnet defaults (pre-existing, labelled testnet). Circle keys optional.

### settlekit-worker
- [ ] Same chain, Zcash, HyperCore, routing and onchain-billing values as the API (renewals, route-watch and zcash-watch run here).
- [ ] Delivery + email: `GITHUB_APP_*`, `DISCORD_BOT_TOKEN`, `RESEND_API_KEY`, `EMAIL_FROM`, `FILE_DELIVERY_BASE_URL`.
- [ ] Optional payout reconcile: `CIRCLE_WALLETS_API_KEY`, `CIRCLE_WALLETS_WALLET_ID`.

### settlekit-checkout
- [ ] `CHECKOUT_PUBLIC_URL` (its own URL), `SETTLEKIT_API_URL` and `NEXT_PUBLIC_API_URL` (api URL), `CHECKOUT_DOWNLOAD_BASE`.
- [ ] Same chain, Zcash, HyperCore and routing values as the API.
- [ ] `GITHUB_APP_*`, `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`.

### settlekit-dashboard
- [ ] `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CHECKOUT_URL`, `NEXT_PUBLIC_DISCORD_CLIENT_ID`.

### settlekit-web
- [ ] `NEXT_PUBLIC_API_URL` (the `/proof` page reads `/v1/public/proof`), `NEXT_PUBLIC_CHECKOUT_URL`, `NEXT_PUBLIC_DASHBOARD_URL`, `NEXT_PUBLIC_DOCS_URL`.

- [ ] After all URLs exist, redeploy every Next service (NEXT_PUBLIC_* values are baked at build time).

## 5. Database migrations

- [ ] The API container applies pending migrations on boot (`packages/database/dist/cli.js` in `apps/api/Dockerfile`). Check the first API deploy log for a successful migration run.
- [ ] If running outside Docker: `pnpm --filter @settlekit/database db:migrate` with `DATABASE_URL` set.
- [ ] Confirm `GET <api>/health` is 200 and `GET <api>/v1/public/proof` returns `{ data: ... }`.

## 6. Smoke test on testnet first (optional but recommended)

- [ ] Temporarily set `SETTLEKIT_CHAIN_ENV=testnet` on a preview or local stack and run `scripts/solana-devnet-e2e.ts` plus one Base Sepolia wallet payment, to confirm wiring before spending mainnet funds.

## 7. First real payment per chain (mainnet, $1 each)

Create one $1 product in the founder's org with a GitHub delivery. For each network, pay once through the hosted checkout, then confirm the row appears on `/proof` under mainnet with a working explorer link and the delivery happened.

- [ ] Solana (USDC, Solana Pay)
- [ ] Base (USDC)
- [ ] Ethereum (USDC; 12 confirmations)
- [ ] Arbitrum (USDC)
- [ ] Robinhood Chain (USDG)
- [ ] HyperEVM (USDC)
- [ ] HyperCore (USDC `usdSend`)
- [ ] Tempo (USDC.e with memo)
- [ ] Zcash (transparent ZEC, ~0.02 ZEC)
- [ ] One any-token route (e.g. ETH on Arbitrum → USDC on Base via Relay)
- [ ] One x402 agent purchase on Solana (`agent-buy-solana`), one on an EVM chain (`agent-buy-evm`), one MPP purchase on Tempo (`agent-buy-tempo`)
- [ ] One Base subscription (spend permission or Permit2) and one worker renewal or manual `charge`
- [ ] One refund sent on-chain from the dashboard
- [ ] Update the "Mainnet proof" column in [SUBMISSION.md](./SUBMISSION.md): any network without a mainnet row stays labelled testnet-only.

## 8. Onboard the founder's products (dogfood)

- [ ] Menivor: product(s) and payment links; SaaS entitlement check by email per `/docs/integrate`; seller webhook to the Menivor API; replace or sit beside the current Dodo checkout as a "pay with stablecoins" option.
- [ ] Scribase: same pattern (plan entitlement by email, webhook to provision).
- [ ] Rally: same pattern.
- [ ] Add each product's link to its own pricing page; track real (non-founder) payments separately.
- [ ] Ensure the founder's test purchases use an org in `PROOF_EXCLUDED_ORGS` or are clearly founder-funded; do not present self-payments as customer traction.

## 9. Recordings

- [ ] Dry run of [DEMO-SCRIPT.md](./DEMO-SCRIPT.md), then record the demo (3:00 max).
- [ ] Record the pitch from [PITCH-SCRIPT.md](./PITCH-SCRIPT.md) (2 to 3 min) with real `/proof` numbers.
- [ ] Upload both (YouTube unlisted or Loom), check they play logged out.

## 10. Submission form (Colosseum)

- [ ] Project name, one-liner and description from [SUBMISSION.md](./SUBMISSION.md).
- [ ] Tracks/chains: Solana, Ethereum, Base, Arbitrum, Hyperliquid, Tempo, Zcash, Robinhood Chain (only those with working flows; note testnet-only ones honestly).
- [ ] Links: GitHub repo + branch, live web URL, `/proof` URL, checkout example link, pitch video, demo video.
- [ ] Pre-existing code disclosure: paste the Disclosure section (baseline `7c6f6ce`, 2026-06-22, tag `pre-colosseum-baseline`; in-window = `git diff pre-colosseum-baseline..HEAD`). Recompute the stats if more commits land before submission.
- [ ] Traction: fill the template in SUBMISSION.md from `/proof` on submission day.
- [ ] Team: founder bio and the MoR rejection story.
- [ ] Submit by Oct 11 (one day of margin before the Oct 12 deadline).
