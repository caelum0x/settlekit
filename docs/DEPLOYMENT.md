# Deploying SettleKit

SettleKit is a pnpm monorepo: a Hono **API** + a background **worker** (both
Dockerized, Postgres-backed) and several **Next.js apps** (`web` marketing,
`dashboard`, `marketplace`, `docs`, `checkout`, `portal`, `admin`).

Two supported paths: **Render** (full stack incl. API/worker/DB) and **Vercel**
(the Next.js sites). Circle/Arc API keys are added *after* launch — every
integration is cred-gated, so the stack runs without them (each feature is a
clear "not configured" no-op until its key is set).

## Render (full stack) — `render.yaml` blueprint

`render.yaml` at the repo root is a Render Blueprint. **Deploy via Blueprint —
NOT as a plain Web Service** (see Troubleshooting below for why). From the Render
dashboard:

1. **New → Blueprint**, connect the GitHub repo, pick `render.yaml`.
2. Render provisions: `settlekit-db` (Postgres), `settlekit-api` + `settlekit-worker`
   (Docker), and `settlekit-web` / `dashboard` / `marketplace` / `checkout` / `docs`
   (Next.js). Each Next service starts with `next start -p $PORT` so Render detects
   the open port.
3. Signing secrets (`*_SECRET`, `API_BOOTSTRAP_KEY`) are **auto-generated**.
   `DATABASE_URL` is wired from the database automatically.
4. **Migrations run automatically**: the API service's `preDeployCommand` runs the
   bundled migrator (`node /app/packages/database/dist/cli.js`) against `DATABASE_URL`
   before each deploy goes live. It's idempotent — a deploy with no new migrations
   is a no-op. (To run manually: `DATABASE_URL=… pnpm --filter @settlekit/database migrate:run`.)
5. After the first deploy, set the cross-service URLs in each service's Environment:
   - `settlekit-dashboard` / `marketplace` / `checkout` → `NEXT_PUBLIC_API_URL` = the API's URL.
   - `settlekit-web` → `NEXT_PUBLIC_DASHBOARD_URL`, `NEXT_PUBLIC_MARKETPLACE_URL`,
     `NEXT_PUBLIC_DOCS_URL`.
6. **Later (when live):** add the Circle/Arc keys (`CIRCLE_*`, `GAS_STATION_API_KEY`,
   `COMPLIANCE_API_KEY`, `ARC_CHAIN_ID=5042002`) to `settlekit-api` (+ wallet keys to
   the worker). Each flips its feature live; see `.env.example`. The platform
   take-rate is configurable via `PLATFORM_FEE_BPS` / `PLATFORM_FEE_FIXED` (default
   2.5% + 0.30).

> **Commit the lockfile.** Every service installs with `--frozen-lockfile`, so
> `pnpm-lock.yaml` must be committed and current (run `pnpm install` and commit it
> after any dependency change), or the build fails before it starts.

## Troubleshooting

**`ERR_PNPM_NO_SCRIPT_OR_SERVER: Missing script start or file server.js` /
`No open ports detected`** — the service was created as a plain **Web Service**
pointing at the repo root, so Render runs its default `pnpm start`. The monorepo
root has no `start` script and binds no port, so it fails. **Fix:** delete that
service and redeploy via **New → Blueprint** (above), which gives each app its own
build/start command. If you must configure a service by hand instead, set:

| Service     | Build command                                                                          | Start command                                              |
| ----------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| API         | *(use Docker: `apps/api/Dockerfile`)*                                                   | *(Docker `CMD`)*                                           |
| Worker      | *(use Docker: `apps/worker/Dockerfile`)*                                                | *(Docker `CMD`)*                                           |
| Marketing   | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @settlekit/web... build`             | `pnpm --filter @settlekit/web exec next start -p $PORT`             |
| Dashboard   | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @settlekit/dashboard... build`       | `pnpm --filter @settlekit/dashboard exec next start -p $PORT`       |
| Marketplace | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @settlekit/marketplace-app... build` | `pnpm --filter @settlekit/marketplace-app exec next start -p $PORT` |
| Checkout    | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @settlekit/checkout-app... build`    | `pnpm --filter @settlekit/checkout-app exec next start -p $PORT`    |
| Docs        | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @settlekit/docs-app... build`        | `pnpm --filter @settlekit/docs-app exec next start -p $PORT`        |

The Next.js package names are `@settlekit/web`, `@settlekit/dashboard`,
`@settlekit/marketplace-app`, `@settlekit/checkout-app`, `@settlekit/docs-app`
(the `-app` suffix matters for the last three).

## Vercel (the Next.js sites)

Vercel deploys the Next apps fastest. For each site, create a Vercel project from
the same repo and set **Root Directory** to the app:

| Site        | Root Directory      |
| ----------- | ------------------- |
| Marketing   | `apps/web`          |
| Dashboard   | `apps/dashboard`    |
| Marketplace | `apps/marketplace`  |
| Checkout    | `apps/checkout`     |
| Docs        | `apps/docs`         |

`apps/web/vercel.json` already sets the pnpm-workspace install + build commands
(Vercel auto-detects Next.js otherwise). Set the same `NEXT_PUBLIC_*` env vars as
above in each Vercel project. Point the marketing site's domain at the Vercel
project; keep the **API + worker on Render** (Vercel is serverless and not suited
to the long-lived worker / Postgres backend).

## Recommended split

- **Render:** `settlekit-api`, `settlekit-worker`, `settlekit-db` (the backend).
- **Vercel:** `apps/web` (marketing) + optionally `dashboard` / `marketplace` / `docs`.
- Wire the Next apps' `NEXT_PUBLIC_API_URL` to the Render API URL.

## Branding assets

Web assets are generated from the source logos in `design/brand-source/`:
- per-app `app/icon.png` + `app/apple-icon.png` (browser tab + iOS),
- `apps/web/public/favicon.ico`, `logo-mark.png` (navbar), `logo-wordmark.png`,
- `apps/web/app/opengraph-image.png` (social share).

Regenerate with ImageMagick from `design/brand-source/` if the logo changes.
