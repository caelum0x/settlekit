# @settlekit/oss-fund

**Fund the open-source maintainers your dependency tree actually leans on.**

Every developer depends on hundreds of packages whose maintainers are usually
paid nothing. "Donate" buttons fail because nobody sends 50 cents to thirty
maintainers by hand — the card fee dwarfs the gift, so it never happens. On top
of SettleKit's nanopayment spine, sub-cent USDC settles for free, so a single
small monthly budget can fan out across an entire dependency tree.

```
package.json / requirements.txt
        │  parse + lockfile → dependency graph
        ▼
   signals per package ──▶ maintainer wallets (payee registry / escrow)
   directness · reach     │
   usage · underfunding    │  allocation engine (heuristic | Claude)
        │                  ▼
        └────────▶ conserved, signal-weighted split ──▶ recursive-split settlement
```

## Run it

```bash
pnpm --filter @settlekit/oss-fund build

node packages/oss-fund/dist/cli.js              # seeded acme-web tree, $5 budget
node packages/oss-fund/dist/cli.js ./package.json ./package-lock.json
BUDGET=20 node packages/oss-fund/dist/cli.js ./requirements.txt
```

Set `ANTHROPIC_API_KEY` to use Claude (`claude-opus-4-8`) as the allocation brain
instead of the deterministic heuristic engine.

When you point it at a real manifest, the CLI:

- **Resolves maintainers live** — npm registry metadata → the package's GitHub
  owner, refined by `.github/FUNDING.yml` (sponsor handle + a funding/claim URL).
  Maintainers who have registered a wallet are paid directly; everyone else is
  earmarked to escrow. Set `OSS_FUND_OFFLINE=1` to skip the network entirely.
- **Scans your source for real usage** — counts how many of your files import
  each dependency and feeds that into the `usage` signal (a package you import in
  forty modules outweighs one pulled in once). Pure filesystem, no network.

Over HTTP (public, no API key):

```bash
curl "localhost:8787/v1/fund/demo?budget=5"
curl -X POST localhost:8787/v1/fund/plan -H 'content-type: application/json' \
  -d '{"budget":"10","manifest":"<your package.json>","lockfile":"<your lock>"}'
```

## The allocation decision (the hard part)

This is **not** an equal split. The allocator weighs four signals per package:

| Signal | The question it answers |
|---|---|
| **directness** | How directly do you depend on it? (1 = a direct dep, decays with depth) |
| **reach** | How load-bearing is it? — how many packages in your tree transitively depend on it |
| **usage** | How heavily do you actually use it? (import scan, or in-degree as a proxy) |
| **underfunding** | How little does the maintainer already receive? |

The heuristic engine scores `runtimeFactor · (wD·directness + wC·log(reach) +
wU·usage + wF·underfunding)`. The Claude engine reasons over the same signals and
a funding philosophy, but — exactly like the paying agent's spend policy — it can
only *propose weights*. The capability layer enforces every invariant: the split
is converted to a conserved integer allocation (the legs sum to the budget
exactly, no money created or lost), only resolvable wallets are paid, and
unregistered maintainers are earmarked to an escrow wallet, claimable later.

Settlement reuses the same pluggable `Settler` as the rest of SettleKit (local
ledger for demos/tests, Circle programmable wallets for real testnet USDC), and
`toDistributorCall()` flattens a plan into the exact calldata the on-chain
`RecursiveSplitDistributor` consumes for a one-transaction atomic payout.
