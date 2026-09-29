# SettleKit Operator: an autonomous business operator on Arc

Entry for the Tameion Agents Hackathon (Canteen x Circle, Arc). Branch `feat/tameion-arc`.

## Pitch

**RFB 4, Autonomous Business Operator (headline).** A small business sells in USDC on Arc through SettleKit checkout. The money lands in an `OperatorVault`, and a Claude agent runs the back office from there: it allocates every sale across operating float, tax reserve, yield sleeve and refund reserve, pays vendors and contractors, buys x402 services and handles refunds. Anything above a threshold, to an unknown payee, or flagged by screening goes to the human owner. Every decision is hash-chained and anchored on Arc, so anyone can check what the agent decided, why, and that the reasoning existed before the money moved.

- **RFB 2, AP/AR (workflow):** revenue in from checkout (AR), bills out (AP) through manual entry or pasted invoice text that Claude extracts. Unknown payees are escalated, never auto-paid.
- **RFB 1, Treasury (workflow):** policy-driven allocation, tax reserve the agent cannot spend, a minimum float, and a yield sleeve with a USYC adapter hook.
- **RFB 5, Screening:** every counterparty is screened with Circle's Compliance Engine plus `@settlekit/risk` rules on payment history. A screening outage is treated as unknown, not clean.

## How it works

```
 checkout (Arc USDC) --> OperatorVault <-- agent (Circle DCW) --- Claude + tools
                              |                                      |
                         on-chain caps                        off-chain policy
                         allowlist, TAX lock                  risk + compliance
                         Pending escalations  <-- owner approve/reject (console)
                              |
                     DecisionAnchored(decisionHash) --> public /proof + /verify
```

### Three layers of policy

1. **Off-chain evaluate (agent side).** `packages/operator/src/policy.ts` `evaluate()` runs before any action: allowlist, per-payment and daily caps, bucket balance, TAX lock, minimum float, x402 daily budget, risk and compliance. Deny reasons are ordered exactly like the vault's checks, so the off-chain verdict predicts the on-chain revert. The off-chain policy may be stricter than the vault, never looser; `PUT /v1/operator/policy` refuses any drift from on-chain caps or allowlist.
2. **On-chain vault (Arc).** `contracts/src/OperatorVault.sol` enforces caps, the UTC-day spend window, the payee allowlist and the TAX lock no matter what the agent proposes. Payments above `escalateAbove` become `Pending` escalations that only the owner can approve (which executes) or reject. `pause()` is a kill switch.
3. **Human escalation.** Pending items reach the owner by email or Discord and in the console. They auto-expire after 72h and are recorded as rejected, with the reason logged.

### Hash-chained decision log

Each `DecisionRecord` (event, model, inputs digest, tool trace, policy verdict, rationale, alternatives considered, confidence, outcome, tx hashes, usage and cost, latency) is sha256-hashed over canonical JSON together with `prevHash`. Before execution the agent computes a **commitment hash** of its reasoning, and the vault emits `DecisionAnchored(decisionHash, action)` on every mutation. `GET /v1/public/operator/verify/:id` recomputes the chain and reads the anchor from the Arc receipt.

## Circle tools used

| Tool | Where |
| --- | --- |
| **USDC on Arc** (testnet, chain 5042002) | Checkout settlement, vault accounting, all agent payments (`packages/arc`, `OperatorVault`) |
| **Developer-Controlled Wallets, contract execution** | The agent's signer: vault calls go through Circle DCW `contractExecution` + transaction polling (`packages/operator/src/vault-transport.ts`, `packages/circle-wallets`). A viem signer is the fallback. |
| **Compliance Engine address screening** | Counterparty screening before payouts and refunds (`packages/operator/src/screening.ts`, `packages/compliance`) |
| **USYC (yield)** | `sweepToYield` / `redeemFromYield` through an owner-set `IYieldAdapter`. This is a hook: no adapter is deployed, and without one the vault reverts `YieldDisabled`. |
| **x402 via Circle wallets** | `buy_x402_service` settles from a Circle wallet (`@settlekit/x402-client`), within a daily budget |
| Paymaster | Not used by the operator. On Arc, gas is paid in USDC. |

## Repository map (Tameion delta)

- `contracts/src/OperatorVault.sol`, `contracts/test/OperatorVault.t.sol` (21 forge tests), `contracts/script/DeployOperator.s.sol`
- `packages/operator` (`@settlekit/operator`): policy, allocation, decision log, Claude agent and tools, heuristic engine, vault executor over Circle DCW or viem, escalations, bills, notifier, proof, verify, state, Pg and in-memory stores
- `apps/api/src/routes/operator.ts`: `/v1/operator/{events,decisions,bills,escalations,state,policy}` and public `/v1/public/operator/{proof,verify/:id}`
- `apps/worker/src/jobs/operator-tick-job.ts`: confirmed vault payments become `revenue.received`, due bills become `bill.due`, a daily `tick` runs, and stale escalations expire
- `apps/operator-console` (`@settlekit/operator-console`): owner console, public `/proof`, `/connect` onboarding
- `scripts/operator-arc-e2e.ts`: live Arc testnet end-to-end run
- `render.tameion.yaml`: Render blueprint (db, api, worker, console)

## Run locally

Use filtered installs only; never install the whole monorepo.

```bash
pnpm install --filter "@settlekit/api..." --filter "@settlekit/worker..." --filter @settlekit/operator-console
npx tsc -b packages/operator apps/api apps/worker

# API in labelled simulation (no chain), bootstrap key = owner
cd apps/api && API_BOOTSTRAP_KEY=dev-owner-key OPERATOR_SIMULATION=1 \
  OPERATOR_ALLOWLIST=0xYourVendor node dist/server.js          # :8787

# Console
cd apps/operator-console && OPERATOR_API_URL=http://localhost:8787 \
  OPERATOR_CONSOLE_API_KEY=dev-owner-key CONSOLE_OWNER_PASSWORD=choose-one \
  CONSOLE_SESSION_SECRET=$(openssl rand -hex 32) pnpm dev       # :3009
```

For real on-chain operation, deploy the vault and set `OPERATOR_VAULT_ADDRESS` plus a signer (see `.env.example`, "Autonomous operator"):

```bash
cd contracts && OPERATOR_VAULT_OWNER=0xOwner OPERATOR_VAULT_OPERATOR=0xAgentDcw \
  forge script script/DeployOperator.s.sol --rpc-url https://rpc.testnet.arc.network \
  --private-key $DEPLOYER_KEY --broadcast
```

### Tests

```bash
cd contracts && forge test                                   # OperatorVault and existing contracts
npx vitest run packages/operator                             # operator core
npx vitest run apps/api apps/worker                          # full API + worker suites
npx vitest run apps/operator-console                         # console logic + onboarding against the real API app
cd apps/operator-console && npx next build && rm -rf .next
```

### Live end-to-end on Arc testnet

`scripts/operator-arc-e2e.ts` runs a sale, allocation, a paid bill, an escalated bill, owner approval, and verification of every decision against `DecisionAnchored`. It moves testnet USDC, so it refuses to run without `LIVE=1`:

```bash
cd contracts && forge build && cd ..
LIVE=1 OWNER_PRIVATE_KEY=0x.. PAYER_PRIVATE_KEY=0x.. VENDOR_ADDRESS=0x.. \
  OPERATOR_WALLET_ADDRESS=0x.. CIRCLE_API_KEY=.. CIRCLE_ENTITY_SECRET=.. \
  ANTHROPIC_API_KEY=.. apps/api/node_modules/.bin/tsx scripts/operator-arc-e2e.ts
```

## Demo script (under 3 minutes)

1. **0:00 Problem (15s).** A small team gets paid in USDC but still does treasury, AP and refunds by hand.
2. **0:15 Sale (30s).** Open an Arc checkout link from `/connect` and pay with testnet USDC. The worker turns the confirmed payment into `revenue.received`, and the agent allocates it. Show the decision in `/decisions/[id]` with rationale, alternatives, policy verdict and tool trace.
3. **0:45 AP (30s).** Paste an invoice into `/bills`. Claude extracts it, and the allowlisted vendor is paid inside the caps. Open the Arcscan link.
4. **1:15 Guard rails (40s).** Add a bill above `escalateAbove`: the vault holds it as `Pending`. Add one to an unknown wallet: it is escalated off-chain. Approve one and reject the other in `/escalations`. Show `/policy` with on-chain vs off-chain values and the drift indicator.
5. **1:55 Proof (40s).** On the public `/proof` page, show orgs, counterparties, USDC in and out, outcomes including blocked by policy and blocked on-chain, median latency and cost per decision. Click "Verify on Arc" on a decision and show the `DecisionAnchored` event on Arcscan.
6. **2:35 Close (20s).** Circle tools used, what is next (USYC adapter, more teams), and the repo link.

## Traction (fill in before submission)

All figures are on Arc testnet and taken from `/proof`, which excludes the `demo` org.

| Metric | Value | Source |
| --- | --- | --- |
| External teams onboarded via `/connect` | _TBD_ | distinct orgs on /proof |
| Distinct counterparties | _TBD_ | /proof |
| USDC in / out (testnet) | _TBD_ | /proof |
| Decisions (executed / escalated / blocked by policy / blocked on-chain) | _TBD_ | /proof |
| Median decision latency | _TBD_ | /proof |
| Claude cost per decision | _TBD_ | /proof |
| Real vendor bills mirrored on testnet | _TBD_ | labelled "testnet mirror of real invoice" |
| Team quotes / feedback | _TBD_ | |

## Open-source components (all permissive)

Next.js (MIT), React (MIT), Hono (MIT), viem (MIT), zod (MIT), @anthropic-ai/sdk (MIT), Vitest (MIT), Foundry/forge tooling (MIT/Apache-2.0). The Solidity contracts have no third-party dependencies.

## Disclosure

- **Baseline.** Tag `pre-tameion-baseline` = `7c6f6ce` (2026-06-22), the state of SettleKit after the earlier Lepton entry. Only the delta counts for this hackathon:

  ```bash
  git diff --stat pre-tameion-baseline..feat/tameion-arc
  ```

- **Not claimed as new (dependencies from the Lepton entry and earlier):** `packages/agent`, `packages/x402-client`, `packages/citation-toll`, `packages/streaming`, `packages/agent-economy`; contracts `LeptonStreamSettlement`, `RecursiveSplitDistributor`, `AgentReputationBond`; `apps/arc-fintech` (vendored Circle starter); and the existing SettleKit commerce stack (checkout, payments, treasury, risk, compliance, circle-wallets packages).
- **Shared security fixes.** Fail-closed payment confirmation (the API rejects confirmations on any network without an on-chain verifier; one tx hash can settle only one payment) and worker `payTo` verification were cherry-picked from the Colosseum (Solana) branch and are also part of that entry. On this branch the Solana parts are removed: a `solana` network is rejected as unsupported. They are disclosed as shared fixes, not Tameion features.
- **No Solana.** This entry does not include `packages/solana` or a Solana checkout.
