# @settlekit/cli

The official **SettleKit** command-line interface — manage your commerce OS from the terminal. Sell software, private repos, SaaS, APIs, and AI tools in USDC, and drive every resource the [SettleKit HTTP API](../api) exposes.

## Install & build

```bash
pnpm --filter @settlekit/cli build
# then run the built binary:
node apps/cli/dist/index.js --help
# or link it globally:
cd apps/cli && npm link    # provides the `settlekit` command
```

During development you can run without building:

```bash
pnpm --filter @settlekit/cli dev -- products list
```

## Configuration

The CLI resolves the API connection from flags or environment (flags win):

| Setting   | Flag          | Env var               | Default                  |
| --------- | ------------- | --------------------- | ------------------------ |
| Base URL  | `--api-url`   | `SETTLEKIT_API_URL`   | `http://localhost:8787`  |
| API key   | `--api-key`   | `SETTLEKIT_API_KEY`   | — (required)             |
| Raw JSON  | `--json`      | —                     | off (formatted tables)   |

```bash
export SETTLEKIT_API_URL=http://localhost:8787
export SETTLEKIT_API_KEY=sk_live_...
settlekit products list
```

Add `--json` to any command for raw JSON output (pipe-friendly).

## Commands

```text
products        list | create | get <id> | add-price <id>
customers       list | create
checkout        create | get <id>
payments        create | confirm <id> | refund <id> | get <id>
subscriptions   list | create | get <id> | renew <id> | cancel <id>
refunds         list | create | succeed <id> | fail <id>
disputes        list | open | get <id> | evidence <id> | resolve <id>
dunning         list | start <subId> | attempt <subId> | recover <subId>
entitlements    list | verify | spend-credits | get <id> | revoke <id>
settings        get | update
license-keys    create | verify
api-keys        create | verify
coupons         list | create | validate <code> | redeem <code>
invoices        list | create | finalize <id> | pay <id> | void <id>
marketplace     list | publish | rate <id>
agent-services  list | publish <id> | metadata <id>
payouts         list | create | paid <id>
usage           record | grant-credits | consume-credits | credits
webhooks        endpoints list|create | emit | events list|get <id> | sign | verify
```

### Examples

```bash
# Create a product and a price
settlekit products create --merchant-id mch_1 --organization-id org_1 \
  --name "Pro Repo Access" --type github_repo_access --delivery-mode github_invite
settlekit products add-price prod_123 --amount 25.00 --interval monthly

# Build a checkout session, record + confirm a payment
settlekit checkout create --merchant-id mch_1 --organization-id org_1 \
  --customer-id cus_1 --price-id price_1 --product-id prod_123 \
  --pay-to 0xMerchant --network arc
settlekit payments confirm pay_1 --tx-hash 0xabc... --confirmations 3

# Issue + verify a license key
settlekit license-keys create --organization-id org_1 --customer-id cus_1 \
  --product-id prod_123 --entitlement-id ent_1 --machine-limit 3
settlekit license-keys verify --license-key SK-XXXX --product-id prod_123 --machine-id m1

# Discounts, invoices, payouts
settlekit coupons create --code LAUNCH20 --percent-off 20 --max-redemptions 100
settlekit invoices create --organization-id org_1 --customer-id cus_1 \
  --description "Pro plan" --quantity 2 --unit-amount 15.00
settlekit payouts create --organization-id org_1 --wallet-address 0x... --amount 100 --network arc

# Publish to the marketplace; meter usage-based billing
settlekit marketplace publish --organization-id org_1 --merchant-id mch_1 \
  --product-id prod_123 --title "AI SaaS Boilerplate" --summary "Next.js + USDC" --tags nextjs,saas
settlekit usage grant-credits --organization-id org_1 --customer-id cus_1 --product-id prod_api --credits 20000
settlekit usage consume-credits --organization-id org_1 --customer-id cus_1 --product-id prod_api --credits 1

# Webhooks: register an endpoint, emit a test event, verify a signature locally
settlekit webhooks endpoints create --organization-id org_1 \
  --url https://example.com/hooks/settlekit --events payment.confirmed,delivery.completed
settlekit webhooks emit --organization-id org_1 --type payment.confirmed --data '{"paymentId":"pay_1"}'

# `sign` and `verify` run locally (no API key) — handy in CI or a webhook handler.
# Signature scheme: SettleKit-Signature: t=<unix>,v1=<hmac-sha256("<t>.<body>", secret)>
settlekit webhooks sign --secret whsec_xxx --body '{"id":"evt_1"}'
settlekit webhooks verify --secret whsec_xxx --body '{"id":"evt_1"}' \
  --signature 't=1781610000,v1=...'   # exit 0 = valid, exit 1 = invalid
```

## Output

Every command prints an aligned table (lists) or a key/value summary (single
records). Money is rendered as `25.00 USDC`. Errors surface the API's
`code` + `message` and the CLI exits non-zero, so it composes cleanly in scripts
and CI.
