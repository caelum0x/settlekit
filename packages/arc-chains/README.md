# @settlekit/arc-chains

Dependency-light **source of truth** for Arc / Circle chain, token, and contract
constants. Every SettleKit package and app imports these definitions instead of
re-declaring chain ids, RPC URLs, explorer bases, or registry addresses.

**Pure data + pure functions only — no I/O, no side effects.**

## Why dependency-free

This package takes **zero `@settlekit` dependencies** and sits as a leaf in the
build graph. The ERC-8004 registry addresses and Arc Testnet endpoints are
**mirrored verbatim** from `packages/erc8004/src/addresses.ts` (the canonical
source) rather than imported, because `@settlekit/erc8004` exposes no barrel and
its `dist` is unbuilt. A test asserts the exact mirrored values so drift is
caught immediately. If the erc8004 addresses change, update both and re-run the
test.

## Exports

### Chains (`chains.ts`)

- `ChainDescriptor` — `{ key, displayName, chainId, rpcUrl, explorerUrl, testnet }`
- `SupportedChain` — 8-member union, identical to `@settlekit/app-kit`
- `CHAINS: Record<SupportedChain, ChainDescriptor>` — total record
- `SUPPORTED_CHAINS` — runtime allow-list derived from `CHAINS`
- `getChain(key)` — descriptor lookup (total record, never `undefined`)
- `explorerTxUrl(chain, hash)` → `` `${chain.explorerUrl}/tx/${hash}` ``
- `explorerAddressUrl(chain, addr)` → `` `${chain.explorerUrl}/address/${addr}` ``

> Note: these helpers take a `ChainDescriptor` (per chain), unlike the
> `@settlekit/erc8004` helpers which take a base-URL string. The path format is
> identical so URLs match across packages.

### Tokens (`tokens.ts`)

- `SupportedToken` — 7-member union (`USDC | EURC | USDT | USDe | DAI | PYUSD | cirBTC`)
- `TokenMetadata` — `{ symbol, decimals, address? }`
- `TOKENS: Record<SupportedToken, TokenMetadata>` — symbol-level metadata
- `CHAIN_TOKENS` — optional per-chain token placement
- `getToken(symbol)` — metadata lookup

### Contracts (`contracts.ts`)

- `Erc8004Registries` — `{ identityRegistry, reputationRegistry, validationRegistry }`
- `ARC_TESTNET_REGISTRIES` — the three documented Arc Testnet ERC-8004 addresses
- `CONTRACTS` — forward-compatible per-chain registry map

## Verified Arc Testnet endpoints

| Field        | Value                                |
| ------------ | ------------------------------------ |
| RPC          | `https://rpc.testnet.arc.network/`   |
| Explorer     | `https://testnet.arcscan.app`        |
| Identity     | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| Reputation   | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| Validation   | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` |

## TODO markers (values not yet in the Arc docs)

Nothing below is invented — each is left as a typed empty/undefined sentinel:

- **Arc Testnet `chainId`** — not published in the repo's Arc docs; left as the
  `0` sentinel until verified. The verified RPC/explorer remain the source of
  truth.
- **Arc Mainnet `rpcUrl` / `explorerUrl` / `chainId`** — not yet in Arc docs;
  left as `""` / `0`. Excluded from the non-empty-endpoint test invariant.
- **All token on-chain addresses** — left `undefined`. Addresses are never
  invented; they will be filled when published.

Non-Arc chains (Ethereum / Base / Arbitrum and their Sepolia variants) use
well-known public chain ids and canonical public explorer hostnames. Their RPC
URLs are canonical public defaults — override per environment as needed.

## Build & test

```bash
pnpm --filter @settlekit/arc-chains build   # tsc -b
pnpm --filter @settlekit/arc-chains test    # vitest run
```
