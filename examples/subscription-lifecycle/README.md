# settlekit-subscription-lifecycle

A runnable **TypeScript** walkthrough of the full recurring-billing lifecycle
using [`@settlekit/sdk`](../../packages/sdk):

1. create a customer, a product, and a recurring (monthly) price
2. **subscribe** — an entitlement is granted for the product automatically
3. **verify access** — the SDK hot path (`entitlements.verify`)
4. a payment fails → open a **dunning** campaign, record a failed attempt, then **recover** it
5. **cancel** the subscription

It exercises the `customers`, `products`, `subscriptions`, `entitlements`, and
`dunning` resources end to end against a live SettleKit API.

## Run it

First build the SDK (the example imports its compiled output by relative path —
see `src/sdk.ts`):

```bash
pnpm --filter @settlekit/sdk build
```

Start a SettleKit API locally with a bootstrap key (no database required — it
runs in-memory when `DATABASE_URL` is unset):

```bash
# from the repo root
pnpm --filter @settlekit/api build
API_BOOTSTRAP_KEY=sk_dev PORT=8787 node apps/api/dist/server.js
```

Then, in this directory:

```bash
npm install
SETTLEKIT_API_URL=http://localhost:8787 \
SETTLEKIT_API_KEY=sk_dev \
SETTLEKIT_ORG_ID=org_demo \
npm run dev
```

Expected output ends with `✓ Subscription lifecycle complete.`

## Configuration

| Env var               | Default                   | Notes                                  |
| --------------------- | ------------------------- | -------------------------------------- |
| `SETTLEKIT_API_URL`   | `http://localhost:8787`   | API base URL                           |
| `SETTLEKIT_API_KEY`   | — (required)              | Bearer key; locally use `API_BOOTSTRAP_KEY` |
| `SETTLEKIT_ORG_ID`    | `org_demo`                | Organization the entities belong to    |

## Where to look

- [`src/main.ts`](./src/main.ts) — the five-step walkthrough.
- [`src/sdk.ts`](./src/sdk.ts) — local re-export of `@settlekit/sdk`; swap to the
  published package by changing one import.
