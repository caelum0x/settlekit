# SettleKit Checkout

Hosted multi-chain checkout app (Next.js 14 App Router). A buyer opens a
checkout link, picks one of the networks the merchant accepts (Solana, EVM
chains, Zcash), pays from a wallet (or pastes a transaction hash), and receives
delivered access once the payment is verified on-chain — a private GitHub repo
invite, a license key, an API key, a signed download link, or a Discord role —
driven entirely by real `@settlekit/*` domain packages.

## Chain support

Every network fails closed: it is offered only when the merchant accepted it
AND this deployment verifies it (see `.env.example`). Amounts are USD; EVM
chains settle a 6-decimal USD stablecoin, Zcash settles ZEC at a locked quote.

| Network | Asset (mainnet) | Asset (testnet) | Min conf. | Finality note | Label |
| --- | --- | --- | --- | --- | --- |
| Solana | USDC | USDC (devnet) | commitment `confirmed` | supermajority vote; `finalized` optional | |
| Base | USDC | USDC (Base Sepolia) | 3 | L2 sequencer soft finality; L1 settlement later | |
| Ethereum | USDC | USDC (Sepolia) | 12 | economic finality after ~2 epochs (~13 min); 12 blocks is a reorg margin | |
| Arbitrum One | USDC | USDC (Arbitrum Sepolia) | 3 | L2 sequencer soft finality | |
| Robinhood Chain | **USDG** (Paxos) | Mock USDC | 3 | L2 sequencer soft finality | no native USDC on mainnet |
| HyperEVM | USDC | USDC (testnet, no public explorer) | 1 | HyperBFT, single-block finality | use your own RPC (public: 100 req/min/IP) |
| Tempo | **USDC.e** | pathUSD (Moderato) | 1 | single-slot finality | **bridged** (Stargate), TIP-403 policies may block transfers |
| Arc | — | USDC (Arc Testnet) | 3 | testnet only | **testnet** |
| Zcash | ZEC | — | 3 (~75 s blocks) | probabilistic | **transparent, not shielded**; mainnet only |

Honest labels are shown in the picker and on the payment card: `Testnet`,
`Bridged` (Tempo USDC.e) and `Transparent` (Zcash). Zcash payments use a
transparent t-address: the amount and both addresses are public. Each Zcash
session owes a unique zatoshi amount (the last digits identify the order,
transparent addresses carry no memo); a payment made after the quote expired
is held for manual review. Shielded Zcash is on the roadmap.

EVM payments bind to the session: payTo per network, block time after the
session was created, the connected wallet as payer (wallet flow) and, on Tempo,
a `transferWithMemo` memo of `keccak256(sessionId)`. A pasted hash is
first-claim-wins (a hash settles at most one payment).

## Routes

Pages (App Router):

- `/` — index listing the seeded demo checkout sessions.
- `/c/[sessionId]` — server component; fetches the session from the API,
  renders the order summary, the `NetworkPicker` and the flow for the chosen
  network: `SolanaPay` (Solana Pay QR + Wallet Standard), `EvmPay` (EIP-6963
  wallets, chain switch/add, viem transfer, EIP-681 QR + manual hash) or
  `ZcashPay` (ZIP-321 QR, exact amount, quote countdown, paste txid).
- `/c/[sessionId]/success` — receipt + delivered access (entitlements).
- `/c/[sessionId]/expired` — expired-session notice.

API route handlers (`app/api/v1/checkout-sessions/...`):

- `GET  /:id` — checkout session view (404 unknown, 410 expired).
- `POST /:id/confirm` — validate fields, record + confirm payment via
  `@settlekit/payments`, materialize delivery, return the receipt.
- `GET  /:id/receipt` — receipt + delivered access for a paid session.
- `POST /:id/expire` — transition an open session to expired.
- `POST /:id/network` — `{ network }`: switch to an accepted, configured
  network while open and unpaid (locks a ZEC quote for Zcash).
- `GET  /:id/evm/params` — chain id, add-chain params (public RPC), token,
  exact base units, payTo, Tempo memo, confirmations, explorer.
- `POST /:id/evm/payer` — `{ payer, fields }`: bind the paying wallet.
- `POST /:id/zcash/uri` — `{ fields }`: ZIP-321 request for the locked quote.
- `GET  /:id/zcash/status` — waiting | confirming | review | paid.
- `POST /:id/solana/pay-url`, `GET|POST /:id/solana/tx`, `GET /:id/solana/status`
  — Solana Pay.

State-changing routes refuse cross-site requests (`Origin` / `Sec-Fetch-Site`),
except the Solana Pay transaction request that wallets call cross-origin.
Errors are `{ error, code }`; `payment_pending` (425) means "found, not final
yet, poll again".

## Data + delivery

`lib/store.ts` is the server-side data layer, backed by the real
`InMemoryCheckoutRepository` / `InMemoryPaymentRepository` from
`@settlekit/payments` and seeded (`lib/seed.ts`) with live `Product` / `Price`
records. State transitions go exclusively through the domain functions
(`createCheckoutSession`, `recordPendingPayment`, `confirmPayment`,
`completeSession`).

`lib/deliver.ts` materializes delivered access using the real packages:
`@settlekit/license-keys` (`createLicenseKey`), `@settlekit/api-keys`
(`issueApiKey`), and `@settlekit/file-delivery` (`generateSignedDownloadUrl`),
plus GitHub/Discord grant artifacts.

`lib/api.ts` is the real fetch client used by both server components and the
client form; it talks HTTP to the route handlers above.

## Develop

```bash
pnpm --filter @settlekit/checkout-app dev
pnpm --filter @settlekit/checkout-app typecheck
```

### Environment

See [`.env.example`](./.env.example). Highlights:

- `SETTLEKIT_CHAIN_ENV`, `ENABLED_EVM_CHAINS`, `<KEY>_RPC_URL` — EVM chains
  (same names as the API and worker).
- `SOLANA_CLUSTER` — enables Solana; `ZCASH_ENABLED` — enables Zcash.
- `CHECKOUT_PUBLIC_URL` — public origin (Solana Pay links, CSRF checks).
- `CHECKOUT_API_BASE_URL` — absolute API base for server-side fetches
  (defaults to `http://localhost:$PORT`).
- `CHECKOUT_DELIVERY_SECRET` / `CHECKOUT_DOWNLOAD_BASE` — signed downloads.
- `CHECKOUT_DEMO_*_PAY_TO` — demo receiving addresses (no database).

Demo sessions (no `DATABASE_URL`) accept every EVM chain; run with
`SETTLEKIT_CHAIN_ENV=testnet ENABLED_EVM_CHAINS=base,arbitrum,tempo` to pay them
on testnets. The placeholder EVM address is never offered on a mainnet.

### Open-source components

| Package | License | Use |
| --- | --- | --- |
| viem | MIT | EVM RPC, wallet client, ABI encoding |
| uqr | MIT | QR codes (Solana Pay, ZIP-321, EIP-681) |
| @wallet-standard/app | Apache-2.0 | Solana wallet discovery |
| EIP-6963 / EIP-3085 / EIP-3326 / EIP-681 / ZIP-321 | public standards | wallet discovery, chain add/switch, payment URIs |
