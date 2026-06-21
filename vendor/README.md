# vendor/

Reference code vendored from Circle's public GitHub (`github.com/circlefin`) — the
Arc sample apps, Circle agent/payment samples, and a couple of reference contracts.
These are **outside** the pnpm/tsc/Next workspace globs: reference material, not
part of the SettleKit build. `.git` was removed at vendor time; each repo keeps its
original `LICENSE` where one was published.

Source: `https://github.com/circlefin/<dir>`. Most are Apache-2.0; the Arc samples
are Circle's public "fork and customize" examples.

## Arc sample apps
- `arc-commerce/` — USDC payments for in-app credit purchases.
- `arc-escrow/` — AI-validated escrow: create → deposit → submit → release.
- `arc-nanopayments/` — gasless USDC nanopayments (the Lepton reference).
- `arc-p2p-payments/` — gasless peer-to-peer payments.
- `arc-multichain-wallet/` — unified USDC balance + crosschain via Gateway.
- `arc-fintech/` — multichain treasury / crosschain capital movement.
- `arc-prediction-markets/` — decentralized prediction markets (UMA).
- `arc-stablecoin-fx/` — USDC↔EURC FX via App Kit Swap.
- `arc-defi-lend-borrow/` — cirBTC-collateralized USDC lending (pointer repo).

## Circle samples & SDK references
- `agent-stack-starter-kits/` — Circle Agent Stack × LangChain/Claude/OpenAI/Vercel/Google ADK (pointer repo).
- `circle-cctp-crosschain-transfer/` — CCTP step-by-step crosschain transfer.
- `circle-bridge-kit-transfer/` — Bridge Kit crosschain USDC w/ wallet connect.
- `circle-cctp-fulfiller-repayment/` — CCTP fulfiller pay-first / settle-later.
- `skills/` — Circle's open-source AI-assisted-development skills.
- `recibo/` — encrypted memos for ERC-20 transactions.
- `chainmail/` — authenticated email using the blockchain.

## Reference contracts
- `refund-protocol/` — Solidity stablecoin payment-dispute contract (Apache-2.0).

To refresh any entry: re-clone from the source, `rm -rf .git .github`, keep this list current.
