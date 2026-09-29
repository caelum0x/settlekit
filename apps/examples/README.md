# SettleKit Examples

Example integrations for SaaS plans, GitHub repo sales, paid APIs, bundles, and agent services.

## Agent purchases on every chain (x402 v2 + MPP)

Runnable against a live SettleKit API (they spend real stablecoins on mainnet;
set `SETTLEKIT_CHAIN_ENV=testnet` for testnets). Unset `PRODUCT_ID` to call the
sample paid resource instead of buying.

```sh
# Solana via PayAI
AGENT_SOLANA_SECRET_KEY='[..64 bytes..]' PRODUCT_ID=prod_... pnpm --filter @settlekit/examples agent-buy-solana
# EVM: base | arbitrum (PayAI), ethereum | hyperevm | robinhood (self-hosted facilitator)
AGENT_EVM_PRIVATE_KEY=0x... PRODUCT_ID=prod_... pnpm --filter @settlekit/examples agent-buy-evm hyperevm
# Tempo via MPP (mppx)
AGENT_TEMPO_PRIVATE_KEY=0x... PRODUCT_ID=prod_... pnpm --filter @settlekit/examples agent-buy-tempo
```

Common env: `SETTLEKIT_API_URL` (default `http://localhost:8787`), `AGENT_MAX_USD`
(per-payment cap, default 5), `AGENT_EMAIL` / `AGENT_GITHUB_USERNAME` /
`AGENT_DISCORD_USER_ID` for products whose delivery needs them. Sources:
`src/agent-buy-{solana,evm,tempo}.ts`.

## Lepton nanopayments — the whole economy in one command

```sh
pnpm --filter @settlekit/examples lepton
```

Runs the four Lepton creator-payment flows end-to-end over the local settlement
provider (offline, no creds): an AI agent paying an **x402 citation toll** (RFB 6),
**per-listen royalties** (RFB 6), **per-second streaming** (RFB 4), and the
**OSS fund** conserved split into one-tx on-chain calldata (RFB 6). Set
`SETTLEMENT_PROVIDER=circle` (+ Arc RPC/creds) and the same flows settle in real
testnet USDC on Arc — no code change. Source: `src/lepton-nanopayments.ts`.

## Arc-commerce checkout — accept USDC on Arc (App Kit)

```sh
pnpm --filter @settlekit/examples arc-commerce
```

An eCommerce checkout that builds an order and moves money with Circle **App Kit**:
a same-chain payment where the customer pays USDC directly on Arc (`arc.send`), and
an optional **bridged** payment where the customer's USDC starts on Base and bridges
to Arc via CCTP (`arc.bridge`). It runs offline over `LocalAppKitSdk` (deterministic,
no network, no credentials) and prints a receipt (`txHash`, `explorerUrl`) per leg.

To go live, swap one line — `sdk: new AppKit()` (from `@circle-fin/app-kit`) instead
of `new LocalAppKitSdk()`, and pass a real viem signing adapter
(`createViemAdapterFromProvider` from `@circle-fin/adapter-viem-v2`); the Circle kit
key is read from `CIRCLE_KIT_KEY`. The order math and receipts are identical.
Source: `src/arc-commerce.ts`.
