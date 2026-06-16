# Arc + Circle — Next-Phase Roadmap

Deepening Arc + Circle usage beyond the foundation already shipped. This is the
agreed plan of record; phases are implemented **one by one** in the order below.

## Already shipped (the foundation — do NOT re-do)

- **`@settlekit/arc`** — chain config (real Arc testnet `5042002` addresses for
  USDC/EURC/USYC, CCTP, Gateway, FxEscrow, Permit2, Multicall3), multi-asset
  on-chain transfer verification, USDC-denominated fee estimation. **Live-verified**
  against `rpc.testnet.arc.network`. API: `/v1/arc/{info,fee-estimate,verify}`.
- **`@settlekit/cctp`** — CCTP **V2**: `depositForBurn` + `depositForBurnWithHook`
  (hookData plumbed), Iris attestation polling, `receiveMessage`/mint, domain map,
  `FINALITY_THRESHOLD_STANDARD`(1000)/`FAST`(500). API: `/v1/cctp/{burn-tx,attestation,mint-tx}`.
- **`@settlekit/gateway`** — Unified Balance: deposit, EIP-712 burn intents,
  transfer attestation, gateway-mint, on-chain balance reads. API: `/v1/gateway/*`.
- **`@settlekit/circle-wallets`** + **`@settlekit/treasury`** — dev-controlled W3S
  wallets + treasury policy engine. Real payout execution (`POST /v1/payouts/:id/execute`)
  + `providerRef` persistence + `POST /:id/reconcile` + worker `payout-reconcile` job.
- **`@settlekit/paymaster`** — Circle Paymaster (pay gas in USDC) + Gas Station
  policies. API: `/v1/paymaster/*`, `/v1/gas-station/policies`.
- **`@settlekit/stablefx`** — Circle Mint (mint/redeem) + pure FX quote math.
  API: `/v1/fx/{quote,swap-request}`, `/v1/mint`, `/v1/mint/redeem`.

Every Circle/Arc leg is **cred-gated**: a real client when creds are present, else
`null` / in-memory double. New work MUST preserve this pass-through.

## Blocked / spike-only (do NOT build on guesses)

1. **FxEscrow on-chain ABI — RESOLVED** (was "unpublished"). The contract is
   **verified on-chain** on Arc testnet (proxy `0x8676…`, impl `0x721e…F658`,
   "FxEscrow"); its ABI is captured in `@settlekit/onchain` `fx-escrow-abi.ts`
   (read from the Arc Blockscout explorer). The **EIP-712 witness types** were read
   live from the contract's `*_WITNESS_TYPE()` getters —
   `Consideration(bytes32 quoteId,address base,address quote,uint256 baseAmount,
   uint256 quoteAmount,uint256 maturity)`, `TakerDetails`, `MakerDetails`, funded
   via canonical Permit2. Exposed at `GET /v1/fx/onchain/info`.
   **The off-chain RFQ HTTP schema is ALSO RESOLVED** — sourced from Circle's
   published OpenAPI spec (`developers.circle.com/openapi/stablefx.yaml`).
   `stablefx/rfq.ts` now matches the real endpoints (`/quotes`, `/trades`,
   `/signatures`, `/signatures/presign/{id}`) + shapes: the quote returns the
   EIP-712 `typedData` (`PermitWitnessTransferFrom`) the taker signs, then the
   signed Permit2 message + signature are submitted at trade creation.
2. **USYC on Arc — architectural finding** (not a doc gap): the Arc USYC token is a
   `YieldCoinSatellite` (cross-chain representation, proxy verified). The mint/redeem
   **Teller is NOT co-located on Arc** — subscription/redemption happens on the home
   chain; on Arc the satellite token accrues value by price. So "USYC yield via an
   on-Arc Teller" is not available by design; treasury would hold the satellite token.
3. **Arc mainnet addresses** — unpublished. Stay testnet-scoped; no mainnet cutover.
4. **CCTP V2 hook target contract** — `hookData` is plumbed but there is no on-Arc
   hook handler in the repo. Atomic "credit checkout on mint" needs a deployed
   handler whose interface comes from CCTP V2 hook docs. Spike first.

## Phases (implementation order)

### Phase 1 — Compliance Engine: Transaction Screening (HIGHEST LEVERAGE)
Screen every payout destination + pay-in sender against Circle Transaction
Screening (sanctions/risk) before funds move. Block/hold on `DENIED`/high-risk.
- Extends: `packages/compliance` (17-line stub today), `apps/api/src/payouts/executor.ts`,
  `apps/api/src/routes/payments.ts`, `config/integrations.ts`, `config/env.ts`.
- Steps: (1) spike Circle Transaction Screening API; (2) screening client with an
  injected-transport seam (mirror `circle-wallets/src/http.ts`), map verdict →
  `ComplianceDecision` (`allow|review|block`); (3) gate payout `execute()` — block →
  typed `compliance_blocked` + held state; (4) gate pay-in confirm on the sender;
  (5) cred-gate in `integrations.ts`.
- Fail-safe: unconfigured = pass-through (logged); payout direction blocks on uncertainty.
- Risk: H. Entirely cred-gated.

### Phase 2 — Circle Push Webhooks: real-time settlement + screening alerts
Inbound Circle webhook receiver; settle payouts in real time; ingest screening
alerts. Poll job becomes a slower safety-net fallback.
- Extends: `apps/api` (new `POST /v1/webhooks/circle`), `packages/webhooks`
  (add **inbound** verification — outbound-only today), `payout-reconcile-job.ts`.
- Steps: (1) spike Circle webhook signature scheme (ECDSA + Circle public key —
  distinct from SettleKit's outbound HMAC); (2) inbound verifier
  (`packages/webhooks/src/inbound.ts`); (3) verified, idempotent route advancing
  payouts via `markPaid`/`markFailed`, routing screening alerts to the Phase 1
  decision store; (4) demote poll job to fallback.
- Risk: H (signature verification is security-critical).

### Phase 3 — CCTP V2 Hooks + Fast Transfer (CHEAP / LIVE-NOW quick win)
- Steps (cheap, live-now): (1) add `hookData` to `burnSchema` in `apps/api/src/routes/cctp.ts`
  and thread into `buildBurnTx`; (2) add a `fast` option mapping to
  `FINALITY_THRESHOLD_FAST` + surface the `maxFee` tradeoff.
- Step (expensive, blocked): (3) on-Arc hook handler contract (deploy via
  `create2Factory`) for atomic credit-on-mint — spike the CCTP V2 hook interface first.
- Risk: L for steps 1–2.

### Phase 4 — Wire `services/arc-indexer` for direct on-chain payments
Merchants accept USDC by sharing an Arc address; the indexer auto-confirms.
- **Protocol fix (blocker):** indexer POSTs `/v1/payments/{txHash}/confirm` (txHash
  as id), but the real route needs an internal payment id tied to a checkout session.
- Steps: (1) new `POST /v1/payments/observe` that creates+confirms a payment from an
  observed Transfer, resolving merchant/session by watched address, **re-verifying
  on-chain via `arcVerifier`** (never trust the indexer), running Phase 1 sender
  screening; (2) point `services/arc-indexer/src/settlekit.rs` at it; (3) wire indexer
  to Arc testnet.
- Risk: H.

### Phase 5 — StableFX RFQ (expensive, partially blocked)
Replace the modeled `FxSwapRequest` with the real RFQ flow for USDC↔EURC.
- Spike Circle RFQ API (schemas, signing domain, Permit2 witness) first. Keep
  `computeFxQuote` for previews; add an RFQ client; wire Permit2 funding (address
  in config). Implement last.
- Risk: H.

### Phase 6 — Spikes (researched; findings below)
- **User-controlled wallets — DONE.** Fully documented W3S API; shipped
  `createUserWalletsClient` in `@settlekit/circle-wallets` (create user / mint user
  token / PIN+wallet/transfer **challenges** that the client SDK completes / list
  wallets, all via `X-User-Token`) + cred-gated `/v1/user-wallets/*`. 6 tests.
- **CCTP V2 hook handler — BUILT.** `contracts/src/SettleKitCctpHook.sol` implements
  the published `IMessageHandlerV2`; decodes `hookData = abi.encode(merchant, orderId)`
  and forwards the freshly-minted USDC to the merchant atomically. Compiled (solc
  0.8.30) + 4 Foundry tests. Remaining: deploy to Arc testnet (faucet-funded key).
- **On-chain Arc escrow — BUILT.** `contracts/src/SettleKitEscrow.sol` — trustless
  USDC escrow (fund/release/refund/dispute + arbiter), the on-chain counterpart to
  the off-chain escrow product. Compiled + 9 Foundry tests. Remaining: deploy to Arc.
- **USYC yield — mechanism known, contract details pending.** USYC is a permissioned
  ERC-20 (Hashnote SDYF, Circle-owned) minted/redeemed against USDC via a **Teller
  contract** (T+0). Remaining: the exact Teller address + ABI on Arc (verify at
  developers.circle.com/tokenized/usyc) before encoding deposit/redeem.
- **StableFX — FULLY RESOLVED.** On-chain: FxEscrow ABI + EIP-712 witness types from
  the verified contract (`@settlekit/onchain`; `/v1/fx/onchain/info`). Off-chain: the
  RFQ HTTP schema from Circle's OpenAPI spec (`stablefx.yaml`) — `stablefx/rfq.ts`
  rewritten to match (`/quotes`→typedData, `/trades`, `/signatures`, presign). No
  remaining guesses.
- **Permit2 / Multicall3** — fold Permit2 into Phase 5 funding; Multicall3 deferred.

## Cross-cutting rules

- **Fail-safe gating** — never silently block legit settlement or silently allow a
  sanctioned one; log loudly, choose the safe default per flow.
- **Inbound ≠ outbound webhooks** — the Circle inbound verifier is a separate scheme
  from SettleKit's outbound HMAC (see the `webhook-signing` memory note).
- **Don't trust the indexer** — `observe` re-verifies on-chain.

## On-chain integration (contracts → product)

The Solidity contracts are now usable end-to-end from the API (signer-agnostic):
- **`@settlekit/onchain`** — ABIs + tx-builders for escrow (`createAndFund`/`release`/
  `refund`/`dispute`) + ERC-20 approve. 4 tests.
- **CCTP hook payload** — `encodeSettleKitHookData({merchant, orderId})` in
  `@settlekit/cctp`; `/v1/cctp/burn-tx` accepts `{hook:{merchant,orderId}}` →
  `depositForBurnWithHook` targeting `SettleKitCctpHook`. 4 tests.
- **`/v1/onchain-escrow/*`** — returns unsigned `{to,data,value}` for the escrow
  lifecycle (fund returns the USDC approve + createAndFund). Live-verified.
- **`contracts/script/Deploy.s.sol`** — deploys both contracts (Arc testnet address
  defaults); dry-run simulates cleanly. Broadcast needs a faucet-funded key.

## Status

- [x] Phase 1 — Compliance screening (payout-destination screening shipped; pay-in
      sender screening pending the Arc verifier surfacing `from`)
- [x] Phase 2 — Circle push webhooks (inbound ECDSA verifier + public-key resolver +
      `POST /v1/circle/webhooks` settling payouts in real time; poll job = fallback)
- [x] Phase 3 — CCTP hooks + fast transfer (steps 1–2: `hookData` + `fast` exposed
      on `/v1/cctp/burn-tx`, live-verified; step 3 on-Arc hook handler = spike, deferred)
- [x] Phase 4 — arc-indexer direct payments (`POST /v1/payments/observe` re-verifies
      on-chain + screens sender + records confirmed direct payment, idempotent;
      indexer rewired to it with `ORGANIZATION_ID`. Spoof-rejection live-verified.)
- [x] Phase 5 — StableFX RFQ (real orchestration client quote→trade→funding→status +
      cred-gated `/v1/fx/rfq/*`; exact endpoint schemas + EIP-712 taker-intent/Permit2
      signing structure flagged as needing confirmation vs Circle's api-reference —
      the api-reference pages are not publicly accessible, so wire-details are MODELED
      from the technical guide. Taker signs with their own wallet; no signing helper
      shipped until the EIP-712 schema is published.)
- [~] Phase 6 — user-controlled wallets **DONE**; CCTP hook handler + on-chain escrow
      **contracts BUILT + tested** (`contracts/`, 13 Foundry tests) — pending Arc
      deploy; USYC mechanism researched (need Teller ABI); StableFX exact schemas +
      FxEscrow ABI remain genuinely unpublished
