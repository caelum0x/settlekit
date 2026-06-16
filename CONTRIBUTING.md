# Contributing to SettleKit

Thanks for working on SettleKit. This guide covers how the monorepo is laid out,
how to add a new package or app, and the conventions every contribution must
follow.

---

## Getting started

```bash
corepack enable
corepack prepare pnpm@11.3.0 --activate
pnpm install
pnpm build        # tsc project references, builds packages + apps in order
pnpm typecheck    # tsc -b across the workspace
```

You need **Node 20+** and **pnpm 11**. See [README.md](./README.md) for running
individual apps and [ARCHITECTURE.md](./ARCHITECTURE.md) for the system model.

---

## Repo layout

- `packages/*` — reusable domain libraries published as `@settlekit/<name>`.
  `@settlekit/persistence` holds every Postgres store; `@settlekit/database` the
  drizzle schema, migrations, and doc codec.
- `apps/*` — deployable apps (`api`, `worker`, `cli`, and the Next.js frontends).
- `sdks/*` — first-party SDKs in TypeScript (`packages/sdk`), Python, Go, Rust.
- `clis/*` — standalone CLIs (e.g. the Go `agentpay` x402 agent client).
- `services/*` — edge services in Rust/Go (arc-indexer, x402-gateway,
  license-gateway, webhook-relay).
- `examples/*` — runnable integration examples (Python SaaS, Express x402, Go
  paid client, Rust license check, Next.js SaaS starter).
- `tsconfig.base.json` — shared compiler options (NodeNext, strict,
  `verbatimModuleSyntax`, `noUncheckedIndexedAccess`).
- The pnpm workspace covers `packages/*` + `apps/*` only; `sdks/`, `clis/`,
  `services/`, and `examples/` are self-contained (their own toolchains) so they
  never affect `pnpm -r build`.

### Adding an API endpoint (keep clients in sync)

A new `/v1` endpoint isn't done until the clients can call it. After adding the
route (`apps/api/src/routes/*.ts` + mount in `app.ts` + any context wiring):

1. **TS SDK** (`packages/sdk`): add/extend a resource in `src/resources/`,
   register it in `src/client.ts`, and export it from `src/index.ts`.
2. **Python / Go / Rust SDKs** (`sdks/*`): add the matching method (Python:
   sync + async classes; Go: a `*Client` method; Rust: a resource accessor).
3. If it's a list endpoint backing a dashboard page, thread the listing method
   through the interface → in-memory → Postgres store, not just the route.

---

## Conventions

### TypeScript + ESM (required)

The repo is ESM with `module: NodeNext` and `verbatimModuleSyntax: true`. That
imposes three hard rules:

1. **Relative imports end in `.js`** — you import the compiled output, even from
   a `.ts` source file:

   ```ts
   import { buildDeliveryPlan } from "./delivery-plan.js";
   ```

2. **Workspace imports use the package name with no suffix:**

   ```ts
   import { money, type Entitlement } from "@settlekit/common";
   ```

3. **Type-only imports use `import type`** (or inline `type`), required by
   `verbatimModuleSyntax`:

   ```ts
   import type { Payment, DeliveryRun } from "@settlekit/common";
   ```

`noUncheckedIndexedAccess` is on, so indexed access yields `T | undefined` —
handle the `undefined` case explicitly. Do not use non-null assertions to silence
it.

### Immutability

Never mutate inputs. Build and return new objects:

```ts
// Wrong: mutates the caller's object
function activate(e: Entitlement) { e.status = "active"; return e; }

// Right: returns a new value
function activate(e: Entitlement): Entitlement {
  return { ...e, status: "active" };
}
```

### The `@settlekit/common` contract

`@settlekit/common` is the foundation every other package builds on. It is the
single source of truth for:

- **Domain types** — `Product`, `Price`, `Bundle`, `Customer`,
  `CheckoutSession`, `Payment`, `Subscription`, `Entitlement`,
  `EntitlementType`, `LicenseKey`, `ApiKey`, `DeliveryRun`, `WebhookEndpoint`,
  `AgentService`, `EscrowTask`, `MarketplaceListing`.
- **Money** — the `Money` type and the `money()` constructor. Never represent
  amounts as raw `number`; use `money()`.
- **Result handling** — `Result`, `ok`, `err`, `isOk`, `isErr`. Domain functions
  return `Result` instead of throwing for expected failures.
- **Errors** — `SettleKitError` for exceptional failures.
- **Ids** — `generateId` for all entity ids.

Rules:

- Put a shared domain type in `@settlekit/common`, not in a feature package.
- `@settlekit/common` depends on nothing else in the workspace.
- Prefer `Result`/`ok`/`err` over throwing for recoverable, expected outcomes;
  reserve `SettleKitError` for true exceptions.

### Code style

- Small, focused files (200–400 lines typical). Organize by feature/domain.
- Validate at boundaries (HTTP handlers, external API responses) with Zod.
- API responses use the `{ data }` / `{ error }` envelope — no bare payloads.
- Handle errors explicitly; never swallow them silently.

---

## Adding a new package

1. Create `packages/<name>/` with `src/` and a `tsconfig.json` that extends the
   base and is `composite`:

   ```jsonc
   // packages/<name>/tsconfig.json
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": {
       "rootDir": "./src",
       "outDir": "./dist",
       "composite": true
     },
     "references": [{ "path": "../common" }],
     "include": ["src/**/*"],
     "exclude": ["dist", "node_modules"]
   }
   ```

2. Add `packages/<name>/package.json` named `@settlekit/<name>`, `type: module`,
   with `main`/`types` pointing at `./dist/index.js` / `./dist/index.d.ts`, a
   `build` script of `tsc -b`, and `workspace:*` deps on the packages you use.

3. Add a `references` entry for `../<name>` to the root `tsconfig.json` (and to
   any package/app that imports it) so project-reference builds stay correct.

4. Run `pnpm install` to link the workspace, then `pnpm build`.

> Keep the dependency graph pointing downward (see ARCHITECTURE.md §3): feature
> packages depend on `common` and lower-level packages, never on apps.

## Adding a new app

1. Create `apps/<name>/` with a `package.json` named `@settlekit/<name>`.
   - **Node app** (like `api`/`worker`): `build: "tsc -b"`, a `start` that runs
     `node dist/...`, and a `composite` `tsconfig.json` listing its package
     `references`. Add a multi-stage `Dockerfile` modeled on `apps/api/Dockerfile`
     and a service in `docker-compose.yml`.
   - **Next app**: `dev/build/start` using `next`, with `start` honouring
     `-p $PORT`. Reuse the shared `Dockerfile.next` by adding a service with
     `APP_DIR`, `APP_PKG`, and `APP_PORT` build args, and assign a unique host
     port.

2. Wire the app into `docker-compose.yml` and, if it needs the database, add a
   `depends_on: postgres` with `condition: service_healthy`.

---

## Submitting changes

- Keep commits focused; use conventional commit messages
  (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `perf:`, `ci:`).
- Before opening a PR, ensure `pnpm install --frozen-lockfile`, `pnpm -r build`,
  and `pnpm typecheck` all pass locally.
- Don't commit secrets or a real `.env`.
