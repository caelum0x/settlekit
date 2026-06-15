# @settlekit/api

The SettleKit REST API — [Hono](https://hono.dev) on Node via `@hono/node-server`.

Real route modules per resource are mounted under `/v1`. Every handler calls the
real `@settlekit/*` domain services wired to the in-memory repositories those
packages ship, so the API runs end-to-end with no external infrastructure. When
`DATABASE_URL` is set, a drizzle `Database` handle is created via
`@settlekit/database`.

## Layout

```
src/
  server.ts            createServer + serve (Node entrypoint)
  app.ts               Hono app: mounts routers, error handler
  context.ts           builds service singletons (real services + in-memory repos)
  index.ts             public exports
  middleware/
    auth.ts            Bearer api-key auth (@settlekit/api-keys)
    error.ts           maps SettleKitError -> { error } with httpStatus
  http/
    respond.ts         { data } / { error } envelope helpers
    validate.ts        zod body validation -> 400 SettleKitError
    internal.ts        Result unwrap helper
  clients/             in-process GitHub / Discord / delivery clients
  stores/              generic in-memory record store
  routes/*.ts          one router per resource
test/
  app.test.ts          app.request() end-to-end tests
```

## Endpoints

Core commerce: `products`, `prices`, `customers`, `checkout-sessions`,
`payments`, `subscriptions`, `entitlements`, `api-keys`, `license-keys`,
`files`, `webhooks`.

Plan §26: GitHub (`/v1/integrations/github/*`, `/v1/github/access/*`), Discord
(`/v1/integrations/discord/*`, `/v1/discord/access/*`), SaaS (`/v1/saas/*`),
Bundles (`/v1/bundles*`), Delivery (`/v1/delivery-runs*`,
`/v1/delivery-actions/test`), Agent services (`/v1/agent-services*`), Escrow
(`/v1/escrow/tasks*`).

## Auth

Every `/v1/*` route requires `Authorization: Bearer <api-key>`. Set
`API_BOOTSTRAP_KEY` to allow a static bootstrap key before any keys exist.

## Responses

`{ data: ... }` on success; `{ error: { code, message, details? } }` on failure
with the HTTP status taken from the `SettleKitError`.

## Run

```bash
pnpm --filter @settlekit/api dev     # tsx watch
pnpm --filter @settlekit/api build
pnpm --filter @settlekit/api start
pnpm --filter @settlekit/api test
```
