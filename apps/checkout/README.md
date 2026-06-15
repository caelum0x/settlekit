# SettleKit Checkout

Hosted USDC checkout app (Next.js 14 App Router). A buyer opens a checkout
link, sees the order summary + the pay-to address, submits the on-chain USDC
transaction hash, and instantly receives delivered access — a private GitHub
repo invite, a license key, an API key, a signed download link, or a Discord
role — driven entirely by real `@settlekit/*` domain packages.

## Routes

Pages (App Router):

- `/` — index listing the seeded demo checkout sessions.
- `/c/[sessionId]` — server component; fetches the session from the API,
  renders the order summary + pay-to details, mounts the client `PaymentForm`.
- `/c/[sessionId]/success` — receipt + delivered access (entitlements).
- `/c/[sessionId]/expired` — expired-session notice.

API route handlers (`app/api/v1/checkout-sessions/...`):

- `GET  /:id` — checkout session view (404 unknown, 410 expired).
- `POST /:id/confirm` — validate fields, record + confirm payment via
  `@settlekit/payments`, materialize delivery, return the receipt.
- `GET  /:id/receipt` — receipt + delivered access for a paid session.
- `POST /:id/expire` — transition an open session to expired.

## Data + delivery

`lib/store.ts` is the server-side data layer, backed by the real
`InMemoryCheckoutRepository` / `InMemoryPaymentRepository` from
`@settlekit/payments` and seeded (`lib/seed.ts`) with live `Product` / `Price`
records. State transitions go exclusively through the domain functions
(`createCheckoutSession`, `recordPendingPayment`, `confirmPayment`,
`completeSession`).

`lib/deliver.ts` materializes delivered access using the real packages:
`@settlekit/license-keys` (`createLicenseKey`), `@settlekit/api-keys`
(`issueApiKey`), and `@settlekit/file-delivery` (`generateSignedDownloadUrl`),
plus GitHub/Discord grant artifacts.

`lib/api.ts` is the real fetch client used by both server components and the
client form; it talks HTTP to the route handlers above.

## Develop

```bash
pnpm --filter @settlekit/checkout-app dev
pnpm --filter @settlekit/checkout-app typecheck
```

### Environment

- `CHECKOUT_API_BASE_URL` — absolute API base for server-side fetches
  (defaults to `http://localhost:$PORT`).
- `CHECKOUT_DELIVERY_SECRET` — HMAC secret for signed download URLs.
- `CHECKOUT_DOWNLOAD_BASE` — base URL for signed download links.
