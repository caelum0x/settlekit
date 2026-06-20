# SettleKit — Development Roadmap

Living plan for the continuous feature-development loop. Each iteration: pick the
next unchecked item, implement the **feature/functionality**, verify
`pnpm typecheck` + the relevant `build` stay green (no new test suites — features
first), then commit + push and check the box. Items blocked on credentials
(live Arc/Circle, a real DB host) are marked 🔒 and skipped by the loop.

Convention: `[ ]` todo · `[x]` done · `[~]` in progress · 🔒 blocked-on-creds.

## Phase 1 — Web3 account & session management
- [x] Wallet **unlink** — `DELETE /v1/auth/wallet` + `AuthService.unlinkWallet` (guards against stranding a wallet-only login) + store index cleanup; dashboard "Unlink" button. (portal unlink button: follow-up)
- [x] **Profile** page — view/edit `displayName`; `PATCH /v1/auth/account` + dashboard Profile card (EditProfile).
- [ ] **Active sessions** — list + revoke individual sessions; `GET/DELETE /v1/auth/sessions`; dashboard "Security" section.

## Phase 2 — Agent economy surfaces (ERC-8004 / ERC-8183 → product)
- [ ] API + persistence for **agent identities** (`@settlekit/erc8004` Local port) — register / list / reputation.
- [ ] API + persistence for **agent jobs** (`@settlekit/erc8183` Local port) — create / fund / submit / evaluate / settle, status timeline.
- [x] `apps/agent-console`: **Agents** page (ERC-8004 identity + reputation) and **Jobs** page (ERC-8183 lifecycle timeline), driven by the Local ports.

## Phase 3 — Creator monetization surfaces
- [x] `apps/creator-dashboard`: **Source detail** page — per-source earnings, citations, lineage.
- [x] **Payout detail** page — a payout's legs + recursive split breakdown.
- [ ] **Attribution** management — issue/verify proofs UI on top of `@settlekit/attribution`.

## Phase 4 — Marketplace & checkout depth
- [x] `apps/marketplace`: agent-service **detail** page + tag/search filtering.
- [ ] `apps/checkout`: **wallet-pay** option (App Kit `send` on Arc) alongside hosted USDC.

## Phase 5 — Admin & observability
- [x] `apps/admin`: **settlements** console (status, reconcile view).
- [ ] **Webhook delivery** log + replay UI.
- [ ] **Risk** review queue surface.

## 🔒 Blocked on credentials (not in the loop)
- Live Arc settlement (faucet key + `arc-canteen`/`circle` CLI auth).
- ERC-8004/8183 ABI cross-check against deployed bytecode.
- Production DB migration run (`db:migrate` against a real `DATABASE_URL`).
