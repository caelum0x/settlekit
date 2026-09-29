# Circle Developer Grants — SettleKit update (post as a Questbook Discussion comment by Fri Oct 2, 11:59pm ET)

**Status in one line:** SettleKit has grown from Arc USDC checkout into a multi-chain stablecoin settlement layer with an autonomous, policy-bounded treasury agent on Arc. Arc mainnet contracts are not deployed yet; everything Arc-specific runs on Arc testnet today.

## Product and integration progress since applying
1. **SettleKit Operator (Arc, built for the Canteen × Circle Tameion hackathon).**
   - `OperatorVault.sol`: a USDC vault on Arc with owner/operator roles and four buckets (operating, tax, yield, refund).
     - Enforced on-chain: per-transaction and daily caps, a payee allowlist, a locked tax reserve and a pause switch.
     - Payments above a threshold wait for the owner to approve or reject them.
     - Every action emits `DecisionAnchored(decisionHash)`.
   - `@settlekit/operator`: a Claude-based agent that allocates incoming revenue, pays vendors and contractors, handles refunds, and escalates to a human.
     - Each decision is recorded with its rationale and the alternatives it considered, in a hash-chained log anchored on Arc.
     - It runs on Circle Developer-Controlled Wallets through contract execution, and screens counterparties with the Circle Compliance Engine.
   - Operator console with a public `/proof` page and a `/connect` onboarding flow for other small teams.
   - Code: https://github.com/caelum0x/settlekit/tree/feat/tameion-arc (baseline tag `pre-tameion-baseline`; see TAMEION.md for the exact delta).
2. **Multi-chain checkout** (built for Colosseum), with Arc kept as a first-class network:
   - USDC and other stablecoin checkout on Solana, Ethereum, Base, Arbitrum, HyperEVM/HyperCore, Robinhood Chain, Tempo and Zcash.
   - Every network fails closed: a payment is only confirmed after the transfer is verified on-chain.
   - Buyers can pay with any token through Relay/LI.FI, and the merchant receives USDC.
   - Onchain subscriptions (spend permissions, Permit2, SPL delegate), refunds, and x402 agent payments.
   - Code: https://github.com/caelum0x/settlekit/tree/feat/solana-colosseum
3. **Security hardening:** the verifier registry now fails closed for every network, a transaction hash can only settle one payment, tenant isolation is enforced on all API routes, and wallets must sign to bind a payer.

## Circle tools used
USDC on Arc and other chains; Developer-Controlled Wallets (contract execution); Compliance Engine screening; CCTP/Gateway/Paymaster clients in the repo; a USYC adapter hook in the vault. EURC and Bridge Kit are on the roadmap.

## Traction
[FILL before posting: real merchants/products live, number of payments and USDC volume on Arc testnet and mainnets, links to /proof.]
Plan: the founder's own products (Menivor, Scribase, Rally), which merchants-of-record rejected, are moving their billing to SettleKit first.

## Arc mainnet
Not deployed yet. Once live we will post the `OperatorVault` address with an Arcscan link here.

## Team and funding
[FILL: team changes, if any; funding: none raised / bootstrapped.]
