# Lepton — What's Left

Status of the SettleKit Lepton submission (Canteen × Circle × Arc hackathon,
Jun 15 → **Jun 29 2026**), ordered by judging-criteria impact. Companion to
[../LEPTON_PRODUCTION_PLAN.md](../LEPTON_PRODUCTION_PLAN.md). Verified against the
repo on 2026-06-19.

Judging weights: **Agentic 30% · Traction 30% · Circle tools 20% · Innovation 20%.**

---

## 0. The one blocker that matters most — Traction (30%)

Nothing has settled **real test-USDC on Arc** yet. The entire settlement spine
runs on the `local` provider; the worker's three `lepton-*` jobs
(`lepton-payout-sweep`, `lepton-settlement-reconcile`, `lepton-stream-refund`)
are wired but **no-op** until a `settlementProvider` + an Arc-indexer
`confirmationSource` are injected at deploy.

Going live needs interactive auth (cannot be automated):

1. `uv tool install git+https://github.com/the-canteen-dev/ARC-cli && arc-canteen login`
2. `npm install -g @circle-fin/cli`
3. Deploy contracts with a faucet-funded key:
   `cd contracts && forge script script/DeployLepton.s.sol --rpc-url https://rpc.testnet.arc.network --private-key $DEPLOYER_KEY --broadcast`
4. Set `SETTLEMENT_PROVIDER=circle` + `ARC_INDEXER_URL` and point **one** sidecar
   (recommend `rsshub-citation-toll` — agents are the payers, so volume is
   self-generating) at a real RSSHub/Navidrome/Owncast instance.

Runbook: [../LEPTON_PRODUCTION_PLAN.md](../LEPTON_PRODUCTION_PLAN.md) → "Live testnet runbook".

---

## 1. Built & green (no work needed)

- **Settlement spine** — `@settlekit/settlement-core` (Gateway/Circle/local
  providers, idempotency, batch accumulator, on-chain reconcile).
- **Sidecars (3)** — `rsshub-citation-toll`, `navidrome-scrobble`,
  `owncast-stream`, each with optional bearer auth on money-moving routes.
- **`@settlekit/oss-fund`** — manifest → graph → conserved allocation →
  per-leg-reconciled, idempotent settlement → one-tx distributor calldata.
- **On-chain contracts (3)** — `RecursiveSplitDistributor`,
  `LeptonStreamSettlement`, `AgentReputationBond`; Foundry-tested (25 tests),
  one-command deploy via `contracts/script/DeployLepton.s.sol`.
- **End-to-end demo** — `pnpm --filter @settlekit/examples lepton`.
- **Worker jobs** — three `lepton-*` jobs wired into the scheduler.

Health: 906 unit/integration tests + 25 contract tests green.

---

## 2. Planned in the production plan but **not yet built**

Verified absent on disk.

| Component | Path | Serves | Autonomous? |
|---|---|---|---|
| Reuse-detection + proof-of-citation | `packages/attribution` | Innovation, RFB 6.01 | ✅ yes |
| Operator CLI | `clis/lepton` | Circle-tools / DX | ✅ yes |
| Creator earnings dashboard | `apps/creator-dashboard` | Traction / demo link | ✅ yes (UI) |
| Agent console | `apps/agent-console` | Agentic / Innovation | ✅ yes |
| Stream meter UI | `apps/stream-meter` | Innovation, RFB 4 | ✅ yes |
| Fiat off-ramp | `packages/payouts-cpn` | Creator cash-out | ⚠️ stub only (needs Circle CPN creds to be real) |
| Agent-run Pg store | `packages/persistence` | persistence (deferred) | ✅ yes, small |

---

## 3. Submission deliverables (not code)

- [x] Public GitHub repo
- [ ] **<3min video demo** (required) — the `lepton` demo script is built for this
- [ ] Live deployed link (encouraged) — frontends on Vercel + API on Render are
      up, but the **sidecars are not deployed**
- [ ] Submission form (forms.gle) with traction numbers (users onboarded,
      payments flowing)

---

## 4. Recommended order

1. **Go live on Arc** (section 0) — unlocks the 30% Traction criterion; the rest
   is theater without real USDC moving.
2. **`packages/attribution`** — citation reuse-detection + signed proof-of-citation;
   the missing piece the citation-toll sidecar was designed around. Lifts
   Innovation (20%) and deepens RFB 6.
3. **`apps/creator-dashboard`** — gives a live link + a visible "creators getting
   paid" surface for the video.
4. **Record the <3min video** and submit (submit early/often; resubmission allowed).

---

## 5. Open decisions (need a human call)

- **Which sidecar goes live first** for real traction (recommend `rsshub-citation-toll`).
- **Fiat off-ramp now or later** — include `payouts-cpn` for the submission or defer.
- **On-chain vs. off-chain settlement** — how much moves to the deployed contracts
  vs. staying in `settlement-core` for the demo window.
