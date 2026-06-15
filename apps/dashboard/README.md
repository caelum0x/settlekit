# SettleKit Merchant Dashboard

A Next.js 14 (App Router) dashboard for managing SettleKit commerce: products,
access delivery, billing, and integrations (GitHub, Discord, SaaS, agent
services, escrow).

## Architecture

- `app/` — App Router pages. Server components fetch data via the API client;
  client components (`"use client"`) handle interactive forms.
- `lib/api.ts` — typed HTTP client for the SettleKit API. Reads
  `NEXT_PUBLIC_API_URL` (default `http://localhost:8787`). All reads degrade to
  empty arrays / nulls so pages render graceful empty states when the API is
  unavailable.
- `lib/format.ts` — money (USDC 6-decimals, fiat 2-decimals), date, and number
  formatting.
- `lib/types.ts` — typed response shapes mirroring the `@settlekit/*` domain.
- `lib/nav.ts` — sidebar navigation (plan §16 sections).
- `components/` — shared UI primitives, the `Sidebar`, the `ProductBuilder`
  (plan §28 three-step flow), and the generic create form.

## Sections

Dashboard, Analytics, Products (+ Product Builder), Bundles, Payments,
Customers, Subscriptions, Entitlements, License Keys, API Keys, Files, Delivery
(runs/logs), GitHub (install/repositories/teams/access), Discord
(servers/roles/access), SaaS (plans/features/seats/entitlements), Agent Services,
Escrow, Webhooks, Payouts, Settings.

## Develop

```bash
pnpm install
NEXT_PUBLIC_API_URL=http://localhost:8787 pnpm --filter @settlekit/dashboard dev
# http://localhost:3001
```

## Environment

| Variable              | Default                 | Purpose                     |
| --------------------- | ----------------------- | --------------------------- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8787` | Base URL of the SettleKit API |
