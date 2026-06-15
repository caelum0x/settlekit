# SettleKit Worker

Background worker for delivery execution, payment confirmation, access sync, renewals, and webhook
retries (plan §17). A real Node ESM service that drives the `@settlekit/*` domain packages on
interval-based schedules with graceful shutdown.

## Jobs

| Job              | Cadence env                          | What it does                                                                 |
|------------------|--------------------------------------|------------------------------------------------------------------------------|
| `delivery-runner`| `WORKER_DELIVERY_INTERVAL_MS`        | Executes pending delivery runs through `@settlekit/delivery` `DeliveryRunner` with the concrete wired clients; retries failed runs. |
| `payment-confirm`| `WORKER_PAYMENT_INTERVAL_MS`         | Polls `@settlekit/arc` `verifyUsdcTransfer` / `getConfirmations`, confirms payments via `@settlekit/payments`, and enqueues delivery. |
| `access-sync`    | `WORKER_ACCESS_SYNC_INTERVAL_MS`     | Reconciles GitHub (`syncAccess`) + Discord (`syncDiscordAccess`) grants; expires due entitlements (`@settlekit/entitlements` `expireDue`). |
| `renewal-sweep`  | `WORKER_RENEWAL_INTERVAL_MS`         | Advances subscriptions, enters grace, and expires via `@settlekit/payments`. |
| `webhook-retry`  | `WORKER_WEBHOOK_RETRY_INTERVAL_MS`   | Redelivers failed webhooks via `@settlekit/webhooks` `deliverWithRetry`.      |

## Wiring

`src/wiring/delivery-clients.ts` builds the concrete adapters that implement the delivery package's
client interfaces, each backed by a REAL package call:

- `GithubAccessClient` → `@settlekit/github`
- `DiscordRoleClient` → `@settlekit/discord`
- `LicenseIssuer` → `@settlekit/license-keys`
- `ApiKeyIssuer` → `@settlekit/api-keys`
- `FileGrantor` → `@settlekit/file-delivery`
- `SaasEntitler` → `@settlekit/saas`
- `WebhookSender` → `@settlekit/webhooks`
- `EmailSender` → `@settlekit/notifications`

The GitHub/Discord transports, Arc RPC, email transport, and webhook HTTP sender are injectable, so
the wiring test exercises the exact production assembly path against in-memory doubles.

## Run

```bash
pnpm --filter @settlekit/worker build
pnpm --filter @settlekit/worker start
```

Required env vars are validated at boot (`src/config.ts`); missing secrets fail fast.
