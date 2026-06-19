# SettleKit Examples

Example integrations for SaaS plans, GitHub repo sales, paid APIs, bundles, and agent services.

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
