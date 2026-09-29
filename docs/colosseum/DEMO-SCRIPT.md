# SettleKit demo video script (hard limit 3:00)

Screen recording with voice-over. One continuous story: a seller onboards, then four different buyers pay, one subscribes, one gets refunded, and everything shows up on `/proof`. Cut dead time (confirmations, page loads) in the edit and show a small "waiting for confirmations" caption instead.

Use mainnet with small amounts ($1 to $2) wherever possible, because `/proof` separates testnet and judges can check mainnet explorer links. Any segment recorded on testnet must show the "Testnet" label on screen.

---

## Before recording: setup

Deployment (see [LAUNCH-CHECKLIST.md](./LAUNCH-CHECKLIST.md)):
- [ ] api, worker, checkout, dashboard and web deployed from `render.yaml`, cross-service URLs set, migrations applied (API runs them on boot).
- [ ] `SETTLEKIT_CHAIN_ENV=mainnet`; `ENABLED_EVM_CHAINS=ethereum,base,arbitrum,robinhood,hyperevm,tempo` (at minimum `base`); Solana mainnet RPC (Helius or similar) in `SOLANA_RPC_URL`; `ZCASH_ENABLED=true`; `HYPERCORE_ENABLED=true` if shown.
- [ ] `ROUTING_ENABLED=true` with `RELAY_API_KEY` (LI.FI optional).
- [ ] x402: `X402_SOLANA_PAY_TO`, `X402_EVM_PAY_TO`, `X402_NETWORKS` including `solana`; `X402_REMOTE_FACILITATOR_URL` = PayAI default.
- [ ] Onchain billing: `ONCHAIN_BILLING_OPERATOR_PRIVATE_KEY`, `ONCHAIN_BILLING_NETWORKS` includes `base`, `ONCHAIN_BILLING_CHECKOUT_URL`; worker running (subscriptions renew from the worker).
- [ ] GitHub App installed on the demo org with a private repo; `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID` set on api, worker, checkout.
- [ ] `PROOF_EXCLUDED_ORGS` does NOT include the demo seller org during recording if you want the payments to show; if the demo seller is a throwaway, exclude it after recording.

Wallets and funds:
- [ ] Seller: one EVM address (receives on all EVM chains + HyperCore), one Solana address, one transparent Zcash t1 address.
- [ ] Buyer A: Phantom (or Solflare) on mobile or desktop with ~$3 USDC + a little SOL on Solana mainnet.
- [ ] Buyer B: an EVM wallet (Rabby or MetaMask) holding a non-stablecoin (e.g. ETH or ARB) on Arbitrum or Ethereum, for the any-token route to Base.
- [ ] Buyer C: a Zcash wallet with ~0.02 transparent ZEC (Zashi or YWallet, sending from a transparent balance or any balance to the t-address).
- [ ] Agent: `AGENT_SOLANA_SECRET_KEY` for a Solana keypair with ~$2 USDC (PayAI pays the fee), `SETTLEKIT_API_URL` pointing at the API, `PRODUCT_ID` of the demo product, `AGENT_GITHUB_USERNAME` set to a test GitHub account.
- [ ] Buyer D: a Base Account / Coinbase Smart Wallet (spend permissions) or an EOA (Permit2) with ~$3 USDC on Base, for the subscription.

Content:
- [ ] Demo product "Starter Kit (private repo)" at $1, delivery = GitHub repo access, accepted networks = all enabled.
- [ ] Demo recurring product "Pro plan" at $1/month, subscriptions enabled on Base.
- [ ] Browser tabs pre-opened: dashboard (logged out), checkout link, Solscan, Basescan, Blockchair Zcash, GitHub inbox of the buyer, terminal in `apps/examples`, `/proof`.
- [ ] Do a full dry run the day before; the Zcash leg needs about 3 confirmations (~4 minutes), so record it in advance and cut.

---

## Click path and voice-over

### 0:00 to 0:25 — Seller onboarding
1. Web landing → **Start selling** → dashboard `/signup`, create account.
2. Onboarding wizard, step **Where you get paid**: paste the EVM address, the Solana address, the Zcash t-address. Point at the labels (Bridged, USDG, Transparent).
3. Step **Your first product**: name "Starter Kit", price $1, delivery "GitHub repo access", pick the private repo.
4. Step **Share your link**: copy the payment link (`/l/<slug>`).

VO: "A seller signs up, adds where they want to get paid on each chain, creates a product that delivers a private GitHub repo, and gets one payment link."

### 0:25 to 0:55 — Buyer pays on Solana
1. Open the payment link. The checkout shows the network picker ("Pay with"). Choose **Solana**.
2. Scan the Solana Pay QR with Phantom (or click the wallet button), approve $1 USDC.
3. Checkout flips to paid; receipt shows "GitHub repo access". Cut to the buyer's GitHub inbox: repo invitation.
4. Click the Solscan link on the receipt.

VO: "The buyer pays in USDC on Solana with Solana Pay. SettleKit finds the transfer by its reference key, verifies amount and recipient on-chain, and the GitHub invite arrives by itself."

### 0:55 to 1:25 — Buyer pays with any token from another chain
1. New session from the same link. Choose **Base**, then **Pay with any token**.
2. Pick origin chain Arbitrum and token ETH. Show the quote card: "You pay", "Merchant receives", "Route fee", "Network gas", "Quote valid".
3. Confirm in the EVM wallet. Status goes from routing to paid once the destination fill is seen on Base.

VO: "This buyer only has ETH on Arbitrum. Relay routes it, the seller receives USDC on Base. We don't trust the bridge's status: access is granted only after our verifier sees the USDC land in the seller's wallet."

### 1:25 to 1:45 — Zcash QR (pre-recorded, cut)
1. New session, choose **Zcash**. Show the "Transparent" label, the locked ZEC amount, the quote countdown and the ZIP-321 QR.
2. Scan with the Zcash wallet and send. Cut to status "confirming", then "paid", and the Blockchair link.

VO: "Zcash buyers pay transparent ZEC at a locked dollar quote. A unique amount identifies the order. Shielded payments are on our roadmap, and we label this honestly."

### 1:45 to 2:10 — AI agent buys via x402
1. Terminal in `apps/examples`:
   `AGENT_SOLANA_SECRET_KEY=... PRODUCT_ID=prod_... AGENT_GITHUB_USERNAME=... pnpm --filter @settlekit/examples agent-buy-solana`
2. Show the output: 402 challenge, signed payment, settlement tx, and the returned artifact (repo access granted).

VO: "No human here. An AI agent hits the product endpoint, gets an x402 challenge, pays USDC on Solana, and gets the delivered product back in the same response. MPP on Tempo and x402 on EVM chains work the same way."

### 2:10 to 2:30 — Subscription on Base
1. Open the "Pro plan" link, choose **Base**, click **Subscribe**.
2. Wallet signs the spend permission (or Permit2 allowance) capped at $1/month. First period is charged; receipt shows the manage link.
3. Dashboard → **Subscriptions**: the subscription with next charge date.

VO: "Recurring billing on-chain: the buyer signs a capped allowance once, and our worker charges each period. They can cancel and revoke from their manage link any time."

### 2:30 to 2:45 — Refund
1. Dashboard → **Payments** → open the Base payment from the any-token leg → refund form → **Send refund on-chain**.
2. The refund shows as sent, with an explorer link.

VO: "Refunds actually send the money back, on the same network."

### 2:45 to 3:00 — /proof
1. Open `/proof` on the web app. Show mainnet volume, agent purchases, per-network totals, and the rows just created with explorer links.

VO: "And every payment is public and checkable on our proof page. SettleKit: get paid on any chain, and deliver access automatically."

---

## Fallbacks

- If a Relay route is slow, show the quote and cut to a pre-recorded completion from the dry run.
- If Solana Pay QR scanning is awkward on screen, use the desktop wallet button.
- If the Base subscription wallet does not support spend permissions, use an EOA and the Permit2 path; say "capped allowance".
- Never show a testnet payment without its "Testnet" label visible.
