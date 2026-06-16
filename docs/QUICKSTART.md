# SettleKit Quickstart

Go from zero to a working USDC sale — product → checkout → payment → delivered
access → usage billing — in a few minutes. Every command below hits the real
API; nothing is mocked.

## 1. Run the API

```bash
pnpm install
pnpm --filter @settlekit/api build

# In-memory (no infra) — great for a first run:
API_BOOTSTRAP_KEY=dev-key PORT=8787 node apps/api/dist/server.js

# Or against PostgreSQL (production-shaped, shared by api + worker + checkout):
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/settlekit
pnpm --filter @settlekit/database db:migrate
API_BOOTSTRAP_KEY=dev-key PORT=8787 node apps/api/dist/server.js
```

The API listens on `http://localhost:8787`. Health check:

```bash
curl -s localhost:8787/health
# {"data":{"status":"ok","service":"settlekit-api"}}
```

Set up shell variables used below:

```bash
export SK="http://localhost:8787/v1"
auth=(-H "Authorization: Bearer dev-key" -H "content-type: application/json")
```

## 2. Use the CLI (optional but easy)

```bash
pnpm --filter @settlekit/cli build
export SETTLEKIT_API_URL=http://localhost:8787 SETTLEKIT_API_KEY=dev-key
alias sk='node apps/cli/dist/index.js'

sk products create --merchant-id mch_1 --organization-id org_1 \
  --name "Pro Repo Access" --type github_repo_access --delivery-mode github_invite
sk products list
```

## 3. The core sale (curl)

```bash
# Product + price
PID=$(curl -s "${auth[@]}" -d '{"merchantId":"mch_1","organizationId":"org_1","name":"Pro Repo","description":"Private repo access","type":"github_repo_access","deliveryMode":"github_invite"}' $SK/products | jq -r .data.id)
PRICE=$(curl -s "${auth[@]}" -d '{"amount":"25.00","interval":"one_time"}' $SK/products/$PID/prices | jq -r .data.id)

# Customer + checkout session
CID=$(curl -s "${auth[@]}" -d '{"organizationId":"org_1","email":"buyer@example.com","githubUsername":"octocat"}' $SK/customers | jq -r .data.id)
SID=$(curl -s "${auth[@]}" -d "{\"organizationId\":\"org_1\",\"merchantId\":\"mch_1\",\"customerId\":\"$CID\",\"items\":[{\"priceId\":\"$PRICE\",\"productId\":\"$PID\",\"quantity\":1}],\"payToAddress\":\"0xMerchantWallet\",\"network\":\"base\"}" $SK/checkout-sessions | jq -r .data.id)

# Record + confirm the payment (with Arc configured this verifies on-chain)
PAY=$(curl -s "${auth[@]}" -d "{\"checkoutSessionId\":\"$SID\"}" $SK/payments | jq -r .data.id)
curl -s "${auth[@]}" -d '{"txHash":"0xabc123","confirmations":3}' $SK/payments/$PAY/confirm | jq '.data.entitlements'
# -> an entitlement is granted for the product. The worker then performs the
#    actual GitHub invite / license issue / Discord role, etc.
```

## 4. See it in the dashboard

```bash
NEXT_PUBLIC_API_URL=http://localhost:8787 pnpm --filter @settlekit/dashboard dev
# open http://localhost:3001 — products, payments, the analytics summary, the
# marketplace publish flow, and usage & credits are all live against the API.
```

## 5. Sell an API per call (x402)

```bash
curl -i $SK/paid/research              # 402 Payment Required + PaymentRequirements
# An agent pays 0.005 USDC on Arc, then retries with an X-PAYMENT proof header
# and receives the paid response. Each settled call is metered (paid_calls).
```

Prepaid credits work the same way for metered products:

```bash
curl -s "${auth[@]}" -d '{"organizationId":"org_1","customerId":"'$CID'","productId":"'$PID'","credits":20000}' $SK/usage/credits/grant
curl -s "${auth[@]}" -d '{"organizationId":"org_1","customerId":"'$CID'","productId":"'$PID'","credits":1}'     $SK/usage/credits/consume
```

## 6. Verify access from your app

Use any SDK (`packages/sdk` TS, `sdks/python`, `sdks/go`, `sdks/rust`) or call directly:

```bash
curl -s "${auth[@]}" -d '{"licenseKey":"SK-XXXX","productId":"'$PID'","machineId":"m1"}' $SK/license-keys/verify
curl -s "${auth[@]}" -d '{"key":"sk_live_...","requiredScopes":["read"]}'                $SK/api-keys/verify
curl -s "${auth[@]}" -d '{"customerId":"'$CID'","feature":"ai_export"}'                   $SK/entitlements/verify
```

For the full endpoint reference see [API.md](./API.md); for deployment see
[../PRODUCTION.md](../PRODUCTION.md).
