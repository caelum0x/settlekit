# Circle Developer Grants — SettleKit update (post as a Questbook Discussion comment by Fri Oct 2, 11:59pm ET)

Post as a Discussion comment on the existing application (not by email). If it exceeds the comment limit, split at the `---` markers into two comments.

---

**Update since applying (SettleKit)**

**Summary.** SettleKit has grown from Arc USDC checkout into a multi-chain stablecoin settlement layer. It now includes an autonomous, policy-bounded treasury agent designed for Arc. Arc mainnet contracts are not deployed yet. The Arc contracts are built and tested; the Arc testnet deployment is the next step (see "Arc status").

**1. SettleKit Operator (Arc).** Built during the Canteen × Circle Tameion hackathon.
- `OperatorVault.sol` is a USDC vault with owner and operator roles and four buckets: operating, tax, yield and refund.
- It enforces, onchain:
  - per-transaction and daily caps;
  - a payee allowlist;
  - a locked tax reserve;
  - a pause switch.
- Payments above a threshold wait for owner approval. Every action emits `DecisionAnchored(decisionHash)`. The vault has Foundry tests.
- `@settlekit/operator` is a Claude-based agent. It allocates incoming revenue, pays vendors, handles refunds and escalates to a human. Each decision is written to a hash-chained log with its rationale, and that log is anchored in the vault.
- The agent integrates Circle Developer-Controlled Wallets (contract execution) and Circle Compliance Engine counterparty screening.
- There is an operator console with a public `/proof` page and a `/connect` onboarding flow.
- Code: https://github.com/caelum0x/settlekit/tree/feat/tameion-arc (TAMEION.md lists the exact delta from the pre-hackathon baseline).

**2. Multi-chain checkout, with Arc as a first-class network.**
- USDC and stablecoin checkout on Solana, Ethereum, Base, Arbitrum, HyperEVM, Robinhood Chain, Tempo and Zcash.
- Each network fails closed: a payment is confirmed only after the transfer is verified onchain.
- Buyers can pay with any token through Relay/LI.FI, and the merchant receives USDC.
- Onchain subscriptions (spend permissions, Permit2, SPL delegate), refunds and x402 agent payments.
- Code: https://github.com/caelum0x/settlekit/tree/feat/solana-colosseum

**3. Security hardening.**
- The verifier registry fails closed on every network.
- A transaction hash can settle only one payment.
- Tenant isolation is enforced on all API routes.
- A payer is bound only by a wallet signature.

---

**Circle products**
- **In code:** USDC (Arc and the other chains), Developer-Controlled Wallets (contract execution), Compliance Engine screening, and CCTP, Gateway and Paymaster clients (`packages/arc`), with a CCTP hook contract (`SettleKitCctpHook.sol`, tested).
- **Planned:** EURC, a USYC yield bucket in the vault, and Bridge Kit.

**Arc status**
- Mainnet: not deployed.
- Testnet: the `OperatorVault` deployment script is ready (`contracts/script/DeployOperator.s.sol`). We'll post the testnet address and an Arcscan link here as a follow-up comment once it is broadcast.

**Traction (honest, early stage)**
- No external merchants or real payment volume yet.
- First customers are the founder's own live products, which merchants of record declined to serve: Menivor (AI video), Scribase (backend platform) and Rally (outbound for founders). Their billing moves to SettleKit first, and the `/proof` page will publish those payments as they happen.

**Team and funding**
- Bootstrapped; no outside funding raised. No team changes. <!-- OWNER: confirm both lines before posting -->

**What the grant would fund:** Arc mainnet launch of the Operator vault with controlled signing and observability, plus migrating our own products' billing onto Arc USDC.
