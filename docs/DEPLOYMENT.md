# Deploying SettleKit

SettleKit is a pnpm monorepo: a Hono **API** + a background **worker** (both
Dockerized, Postgres-backed) and several **Next.js apps** (`web` marketing,
`dashboard`, `marketplace`, `docs`, `checkout`, `portal`, `admin`).

Two supported paths: **Render** (full stack incl. API/worker/DB) and **Vercel**
(the Next.js sites). Circle/Arc API keys are added *after* launch — every
integration is cred-gated, so the stack runs without them (each feature is a
clear "not configured" no-op until its key is set).

## Render (full stack) — `render.yaml` blueprint

`render.yaml` at the repo root is a Render Blueprint. From the Render dashboard:

1. **New → Blueprint**, connect the GitHub repo, pick `render.yaml`.
2. Render provisions: `settlekit-db` (Postgres), `settlekit-api` + `settlekit-worker`
   (Docker), and `settlekit-web` / `dashboard` / `marketplace` / `docs` (Next.js).
3. Signing secrets (`*_SECRET`, `API_BOOTSTRAP_KEY`) are **auto-generated**.
   `DATABASE_URL` is wired from the database automatically.
4. After the first deploy, set the cross-service URLs in each service's Environment:
   - `settlekit-dashboard` / `marketplace` → `NEXT_PUBLIC_API_URL` = the API's URL.
   - `settlekit-web` → `NEXT_PUBLIC_DASHBOARD_URL`, `NEXT_PUBLIC_MARKETPLACE_URL`,
     `NEXT_PUBLIC_DOCS_URL`.
5. **Run migrations once** against the new DB (the API seeds defaults on boot; for
   the Postgres schema run `pnpm --filter @settlekit/database db:migrate` with
   `DATABASE_URL` set, e.g. from a one-off Render job or locally).
6. **Later (when live):** add the Circle/Arc keys (`CIRCLE_*`, `GAS_STATION_API_KEY`,
   `COMPLIANCE_API_KEY`, `ARC_CHAIN_ID=5042002`) to `settlekit-api` (+ wallet keys to
   the worker). Each flips its feature live; see `.env.example`.

## Vercel (the Next.js sites)

Vercel deploys the Next apps fastest. For each site, create a Vercel project from
the same repo and set **Root Directory** to the app:

| Site        | Root Directory      |
| ----------- | ------------------- |
| Marketing   | `apps/web`          |
| Dashboard   | `apps/dashboard`    |
| Marketplace | `apps/marketplace`  |
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
