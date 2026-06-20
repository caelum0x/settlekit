# @settlekit/lepton-cli (`lepton`)

Operator CLI for the **Lepton** on-chain settlement stack. Deploy the contracts,
generate a sidecar `.env`, inspect settlement receipts, walk the provenance
lineage graph, and issue / verify citation proofs — all against the same
workspace domain packages the services use.

```
lepton deploy        Deploy the Lepton contracts via forge
lepton config        Generate a sidecar .env
lepton settlements   List / inspect settlement receipts (Postgres)
lepton lineage       Compute attribution shares for a root work
lepton proof         Issue / verify citation proofs
```

Pass `--json` (global) to any command to print machine-readable JSON instead of
formatted tables. Every command exits non-zero on failure.

## Install / build

```bash
pnpm install          # links the workspace member + bin
pnpm -r build         # builds domain deps then this CLI (tsc -b project refs)
node ./dist/index.js --help
```

During development: `pnpm --filter @settlekit/lepton-cli dev -- <args>`.

## Commands

### `lepton deploy`

Shells out to Foundry's `forge script script/DeployLepton.s.sol` from the
contracts directory and prints the three deployed addresses
(distributor / stream / bond).

```bash
# Dry-run (simulation, no broadcast)
lepton deploy --forge-dir contracts

# Broadcast to Arc (needs a funded deployer)
ARC_RPC_URL=https://rpc.testnet.arc.network DEPLOYER_KEY=0x... \
  lepton deploy --broadcast --arc-usdc-address 0x3600...0000
```

| Flag | Env fallback | Notes |
|------|--------------|-------|
| `--rpc-url <url>` | `ARC_RPC_URL` | Required with `--broadcast` |
| `--private-key <key>` | `DEPLOYER_KEY` | Required with `--broadcast`; never logged |
| `--broadcast` | — | Omit for a dry-run |
| `--arc-usdc-address <addr>` | `ARC_USDC_ADDRESS` | Injected into the forge env |
| `--forge-dir <path>` | — | Default `contracts` (must contain `foundry.toml`) |

Requires [Foundry](https://book.getfoundry.sh) (`forge`) on `PATH`.

### `lepton config`

Generates a sidecar `.env` with safe defaults. A fresh
`CITATION_PROOF_SECRET` is generated when one is not supplied, and the file is
written with `0600` permissions. Refuses to overwrite an existing file unless
`--force`.

```bash
lepton config --org-id org_acme --escrow-wallet 0xEscrow \
  --settlement-provider local --out .env.lepton
```

Keys written: `PORT` (8788), `ORG_ID` (org_local), `NETWORK` (arc),
`ESCROW_WALLET`, `CITATION_PROOF_SECRET`, `ARC_INDEXER_URL`
(`https://indexer.testnet.arc.network`), `SETTLEMENT_PROVIDER` (`local`|`circle`).

> The generated file contains a secret — keep it out of version control
> (add `.env.lepton` to `.gitignore`).

### `lepton settlements`

Reads settlement receipts from Postgres (`DATABASE_URL` required).

```bash
DATABASE_URL=postgres://... lepton settlements list --status settled
DATABASE_URL=postgres://... lepton settlements inspect citation:abc:123
```

`list` is by status (one of `pending|submitted|settled|failed`, default
`settled`); `inspect` looks one up by its business reference and exits non-zero
when not found.

### `lepton lineage shares`

Builds a `LineageGraph` and prints `computeAttributionShares` for a root id.

```bash
# Inline edges (child:parent:weight, repeatable)
lepton lineage shares --root c --edge c:b:1 --edge b:a:1

# From a JSON file (array of {child,parent,weight})
lepton lineage shares --root c --edges-file lineage.json

# From the Pg lepton lineage store
DATABASE_URL=postgres://... lepton lineage shares --root c --from-db
```

### `lepton proof`

```bash
# Issue (prints JSON so it can be piped)
CITATION_PROOF_SECRET=secret lepton proof issue \
  --agent agent-1 --source-id s1 --source-id s2 --access-id acc --ttl-seconds 3600

# Verify (from --proof-file or stdin)
lepton proof issue --agent a --source-id s1 --access-id acc --secret x \
  | lepton proof verify --secret x
```

`verify` exits `0` on a valid proof and non-zero on a forged / expired one.

## Environment variables

| Var | Used by | Purpose |
|-----|---------|---------|
| `ARC_RPC_URL` | deploy | Arc RPC URL |
| `DEPLOYER_KEY` | deploy | Deployer private key |
| `ARC_USDC_ADDRESS` | deploy | USDC address for the contracts |
| `DATABASE_URL` | settlements, lineage `--from-db` | Postgres connection string |
| `CITATION_PROOF_SECRET` | config (default), proof | HMAC secret for citation proofs |

Secrets are read from the environment or flags and are never echoed to logs.
