# SettleKit Marketing Site (`@settlekit/web`)

The public marketing site for SettleKit — the Commerce OS that lets developers
sell private GitHub repos, SaaS subscriptions, API access, AI tools, templates,
datasets, license keys, and digital downloads in USDC, with automatic access
delivery.

Built with **Next.js 14 (App Router)**, React 18, and TypeScript. Runs on dev
port **3006**. The site is fully static — it makes no API calls.

## Pages

- `app/page.tsx` — homepage: hero ("Sell your software in USDC"), trust strip,
  "what you can sell" grid, "how it works" steps, developer tools, marketplace
  teaser, and a closing CTA.
- `app/pricing/page.tsx` — the five plans (Free, Creator, Pro, Business,
  Enterprise) with feature lists, per-plan transaction-fee rows, and the
  marketplace-fee note.
- `app/use-cases/page.tsx` — the five killer use cases with target audience and
  promise for each.
- `app/not-found.tsx` — branded 404.

## Structure

- `app/layout.tsx` — root layout with shared `Nav` and `Footer`, site metadata.
- `app/globals.css` — single stylesheet. A clean, modern dark theme with a
  blue→violet accent gradient, card surfaces, and a responsive grid. No Tailwind.
- `components/` — `Nav`, `Footer`, `Hero`, `FeatureGrid`, `Steps`,
  `PricingTable`, `MarketplaceTeaser`, and `CTA`.
- `lib/content.ts` — all marketing copy and structured data (sellable items,
  steps, developer tools, use cases, pricing tiers) sourced from the product
  plan (§2, §29, §32, §34).
- `lib/links.ts` — cross-app URLs (dashboard, marketplace, docs) read from
  `NEXT_PUBLIC_*` env vars with local-dev defaults.

## Cross-app links

The site links out to the other SettleKit apps. Defaults target local dev ports;
override in deployment via environment variables:

| Variable | Default | Target |
| --- | --- | --- |
| `NEXT_PUBLIC_DASHBOARD_URL` | `http://localhost:3001` | Merchant dashboard |
| `NEXT_PUBLIC_MARKETPLACE_URL` | `http://localhost:3011` | Marketplace app |
| `NEXT_PUBLIC_DOCS_URL` | `http://localhost:3000` | Docs app |

## Commands

```bash
pnpm --filter @settlekit/web dev     # start dev server on :3006
pnpm --filter @settlekit/web build   # production build
pnpm --filter @settlekit/web start   # serve the production build on :3006
pnpm --filter @settlekit/web typecheck
```
