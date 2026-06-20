# SettleKit Marketplace

Public marketplace + agent-service discovery, built as a Next.js 14 App Router app.

Humans browse and buy published listings; agents discover machine-callable
services and read their plan §11 JSON metadata. All settlement is USDC over x402.

## Pages

- `/` — published marketplace listings with real search + tag facets (GET query params).
- `/listings/[id]` — listing detail with rating, price, and a Buy button that
  deep-links to a hosted USDC checkout session.
- `/agents` — agent-service directory with text / network / max-price filters.
- `/agents/[id]` — human-readable agent-service page (renders the JSON metadata).
- `/agents/[id]/metadata.json` — Route Handler serving the bare agent-readable
  JSON document (`application/json`, plan §11).
- `/sellers/[slug]` — public seller profile with aggregate reputation + inventory.

## Local REST API (also consumed by the pages)

- `GET /v1/marketplace/listings` — `?q=&tags=a,b&sort=top|new|price`
- `GET /v1/marketplace/listings/:id`
- `GET /v1/marketplace/tags`
- `GET /v1/marketplace/sellers/:slug`
- `GET /v1/agent-services` — `?q=&network=arc|base&maxPrice=&minPrice=`
- `GET /v1/agent-services/:id`
- `GET /v1/agent-services/:id/metadata`

## Data

`lib/api.ts` fetches the published REST API at `NEXT_PUBLIC_API_URL` first, then
falls back to the in-process repository (`lib/repository.ts`). The repository is
backed by the REAL `@settlekit/marketplace-core` and `@settlekit/agent-services`
packages over their in-memory stores, seeded from `lib/seed.ts`. Search, ratings,
fee/price logic, and agent metadata all run through the real package functions.

## Run

```bash
pnpm --filter @settlekit/marketplace-app dev   # http://localhost:3011
```

Env:

- `NEXT_PUBLIC_API_URL` — upstream API base (default `http://localhost:8787`).
- `NEXT_PUBLIC_CHECKOUT_URL` — hosted checkout base (default `http://localhost:3000`).
