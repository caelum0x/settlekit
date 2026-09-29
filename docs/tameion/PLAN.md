# SettleKit Operator — Tameion Agents Hackathon plan (Canteen × Circle, Arc)

Deadline: Oct 10 2026 11:59 PM ET. Submit: public repo, <3 min video, live link, traction.
Judging: agentic 30 / traction 30 / Circle tools 20 / innovation 20. Only the delta built Sep 27–Oct 10 counts.
Branch `feat/tameion-arc` (worktree `~/products/settlekit-tameion`), baseline tag `pre-tameion-baseline` = `7c6f6ce`.
Shared security fixes cherry-picked from `feat/solana-colosseum` (fail-closed verifier, worker payTo) — disclose as shared fixes, not Tameion features.

## Pitch
RFB 4 (Autonomous Business Operator) headline; RFB 2 (AP/AR) and RFB 1 (treasury) are the workflows it runs.
A sale arrives via SettleKit checkout in USDC on Arc → a Claude agent allocates it (operating float / tax reserve / yield sleeve / refund reserve), pays vendors and contractors from the float, buys x402 services, handles refunds; anything over threshold or flagged by screening escalates to a human. Every decision is hash-chained in a public log and anchored on-chain.

## Do NOT present as new (pre-baseline / Lepton delta)
packages/agent, x402-client, citation-toll, streaming, agent-economy; contracts LeptonStreamSettlement, RecursiveSplitDistributor, AgentReputationBond; apps/arc-fintech (vendored Circle starter). Do not include packages/solana or the Solana checkout.

## Build on (existing, real)
- `packages/arc` (`createArcClient`, `verifyUsdcTransfer`, `src/chains.ts` Arc testnet 5042002, USDC/EURC/USYC/CCTP/Gateway addresses, explorer testnet.arcscan.app). Don't use `packages/arc-chains` (chainId 0 TODOs).
- `packages/circle-wallets` (DCW client, `contract-execution.ts` `buildContractExecutionRequest`, `pollTransaction`).
- `packages/treasury/src/policy.ts` (thresholds, daily limit, allowlist), `packages/wallet-fleet/src/caps.ts` (`SpendingCapEnforcer`).
- `packages/risk`, `packages/compliance/src/screening.ts` (Circle Compliance Engine screening).
- `packages/payouts`, `apps/api/src/payouts/executor.ts`, `packages/refunds`, `packages/disputes`, `packages/notifications`.
- `packages/agent/src/claude-engine.ts` pattern (`betaZodTool`, tool runner) — reuse pattern only.
- `packages/persistence` doc-projection (`packDoc`/`unpackDoc`), `InMemoryEntityStore`.
- `apps/api/src/app.ts` route mounting; `apps/worker/src/jobs/index.ts` registry; `contracts/` Foundry (`SettleKitEscrow.sol` as pattern).
- Toys to extend, not rely on: `packages/approvals`, `packages/ledger`, `packages/audit-log`.

## Delta
A. `contracts/src/OperatorVault.sol` + `test/OperatorVault.t.sol` + `script/DeployOperator.s.sol`
- Roles: `owner` (human) and `operator` (agent's Circle DCW address). USDC held; buckets OPERATING, TAX, YIELD, REFUND (internal accounting).
- `allocate(bytes32 decisionHash, uint256[4] amounts)` — only unallocated inflow.
- `pay(decisionHash, bucket, to, amount)` — allowlisted `to`, `amount <= perTxCap`, daily spend `<= dailyCap`, bucket balance; TAX never operator-spendable. Above `escalateAbove` → records `Pending{id}`, emits `Escalated`; only `owner.approve(id)` (executes) / `reject(id)`.
- `sweepToYield` / `redeemFromYield` via owner-set USYC adapter; unset → revert `YieldDisabled`.
- `pause()` kill switch. Every mutation emits `DecisionAnchored(decisionHash, action)`.
- ~12 forge tests: caps, daily window, allowlist, TAX lock, escalate→approve/reject, pause, reentrancy ordering.

B. `packages/operator` (`@settlekit/operator`)
- `policy.ts` `OperatorPolicy` (split %, perTxCap, dailyCap, escalateAbove, minFloat, taxRate, yieldTarget, allowlist, maxX402PerDay); `evaluate()` → `{allow|escalate|deny, reasons[]}`, mirrors vault exactly (combines treasury policy, SpendingCapEnforcer, risk, compliance).
- `events.ts`: `revenue.received`, `bill.due`, `refund.requested`, `dispute.opened`, `tick`.
- `tools.ts`: read tools `get_treasury_state`, `list_open_bills`, `get_counterparty_risk`, `get_payment_history`, `quote_x402_service`; action tools `propose_allocation`, `propose_payout`, `propose_refund`, `buy_x402_service`, `sweep_to_yield`, `escalate`, `defer`. Actions require `rationale`, `alternatives_considered[]`, `confidence`; `policy.evaluate()` first.
- `engine.ts` `OperatorAgent.handle(event)`: Claude (`claude-sonnet-5` routine, `claude-opus-5-5` for escalations/bills; configurable), ≤12 iterations; deterministic `HeuristicOperator` fallback (used in tests).
- `decision-log.ts`: `DecisionRecord{id, eventRef, model, inputsDigest, toolCalls[], policyVerdict, rationale, alternatives, outcome, txHash?, prevHash, hash}`; sha256 of canonical JSON + prevHash; `hash` anchored in vault.
- `executor.ts`: `VaultExecutor` (circle-wallets contract execution + pollTransaction; fallback viem owner/operator key if DCW can't target ARC-TESTNET contracts), `LocalExecutor` for tests.
- `escalation.ts`: pending queue, notifications, 72h auto-expire → rejected with logged reason.
- `store.ts`: in-memory + Pg store self-creating `operator_decisions/operator_bills/operator_escalations` (jsonb). NO drizzle migrations (Solana branch edits them).
- `bills.ts`: AP intake (manual or Claude structured extraction from invoice text); unknown payee → escalate.

C. API `apps/api/src/routes/operator.ts` at `/v1/operator`: `POST /events`, `GET /decisions`, `GET /decisions/:id`, `POST /bills`, `POST /escalations/:id/{approve,reject}`, `GET /policy`, `PUT /policy` (owner only; refuses drift from on-chain values). Public `/v1/public/operator`: `GET /proof`, `GET /verify/:id` (recompute chain + check `DecisionAnchored` on-chain).

D. Worker `apps/worker/src/jobs/operator-tick-job.ts`: confirmed Arc payments without a decision → `revenue.received`; daily `tick`; expire stale escalations. Don't edit `payments.ts`.

E. `apps/operator-console` (Next.js, new dir): `/` balances + spend vs caps; `/decisions`, `/decisions/[id]` (rationale, alternatives, verdict, tool trace, tx, Verify on Arc); `/escalations`; `/policy` on-chain vs off-chain; `/proof` public live metrics + Arcscan links. No emoji glyphs; calm design.

F. `TAMEION.md` (pitch, run, RFB map, Circle tools, disclosure + delta table from `git diff pre-tameion-baseline..feat/tameion-arc`), `render.tameion.yaml`.

## Traction ($0, Arc testnet)
Real flows only: Arc USDC checkout links for the owner's real products (Menivor, Scribase, Rally); real recurring vendor bills mirrored on testnet (labelled "testnet mirror of real invoice"); agent buys other teams' x402 services; onboard 3–5 external small teams from Oct 3. /proof: distinct orgs/counterparties, USDC in/out, decisions (auto / escalated / blocked by policy / blocked on-chain), latency, Claude cost per decision, Arcscan links. Demo/seed data in a `demo` org excluded from /proof.

## Waves
- W0 (9/29–9/30): worktree + cherry-picks (done); owner inputs; verify USYC access + DCW contract execution on ARC-TESTNET.
- W1 (10/1–10/3): OperatorVault + forge tests + deploy script; packages/operator policy, decision log, heuristic engine, LocalExecutor, stores; vitest parity tests with forge cases, hash-chain tamper, bigint allocation, escalation lifecycle.
- W2 (10/4–10/6): Claude engine + tools (fake Anthropic client), VaultExecutor (fake WalletsHttp), API routes, worker job, bills; `scripts/operator-arc-e2e.ts` behind `LIVE=1`.
- W3 (10/7–10/9): operator-console + /proof, deploy, real traction.
- 10/10: video, TAMEION.md, form.

## Constraints
Disk ~6GB: filtered pnpm installs only (`--filter "@settlekit/operator..."` etc.); stop if `df` < 3GB; no local Docker builds. Only shared-file edits: one line each in `apps/api/src/app.ts`, `apps/worker/src/jobs/index.ts`, and `pnpm-lock.yaml`.
Cut first if late: EURC, CCTP, Gateway, invoice parsing.

## Owner-only
`CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET` (registered), two DCW wallets on ARC-TESTNET (operator, owner), faucet USDC, `ANTHROPIC_API_KEY`, deployer key for Foundry, Render account, Luma/Discord handles on the submission form.
