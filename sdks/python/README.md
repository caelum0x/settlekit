# settlekit (Python SDK)

The official **SettleKit** Python SDK — sell software, private repos, SaaS, APIs,
and AI tools in USDC, and guard your own paid APIs with x402 pay-per-call.

Works against the [SettleKit HTTP API](../../apps/api). Python 3.10+.

## Install

```bash
pip install -e sdks/python          # from this repo
# or, once published:  pip install settlekit
```

## Quick start

```python
from settlekit import SettleKit

sk = SettleKit(api_key="sk_live_...", base_url="http://localhost:8787")
# or rely on env: SETTLEKIT_API_KEY / SETTLEKIT_API_URL

product = sk.products.create(
    merchant_id="mch_1",
    organization_id="org_1",
    name="Pro Repo Access",
    type="github_repo_access",
    delivery_mode="github_invite",
)
sk.prices.create(product["id"], amount="25.00", interval="monthly")

for p in sk.products.list():
    print(p["id"], p["name"])
```

The client unwraps the `{ "data": ... }` envelope and raises a typed
`SettleKitError(code, message, status)` on any `{ "error": ... }` response.

### Async

```python
import asyncio
from settlekit import AsyncSettleKit

async def main():
    async with AsyncSettleKit() as sk:
        listings = await sk.marketplace.search(tag="saas", sort="top")
        print(listings)

asyncio.run(main())
```

## Verifying access

Gate your own app on SettleKit entitlements / keys:

```python
from settlekit import verify_license, verify_api_key, verify_entitlement

if not verify_license(license_key, product_id="prod_cli", machine_id=machine_fp):
    raise SystemExit("Invalid license")

if not verify_api_key(presented_key, required_scopes=["read"]):
    raise PermissionError("Bad API key")

if not verify_entitlement(customer_id="cus_1", feature="ai_export"):
    raise PermissionError("Upgrade required")
```

## Selling a paid API with x402

Charge humans **and AI agents** per call. `require_payment` returns HTTP 402 with
the payment requirements when no valid `X-PAYMENT` proof is supplied, and lets the
request through once the buyer has paid:

```python
from fastapi import FastAPI, Depends
from settlekit.x402 import require_payment

app = FastAPI()

@app.get("/research")
def research(_payment=Depends(require_payment(price="0.005", network="arc",
                                              pay_to="0xMerchantWallet",
                                              resource="/research"))):
    return {"answer": "Paid research result"}
```

A runnable example lives in [`examples/paid_api.py`](./examples/paid_api.py):

```bash
pip install -e sdks/python fastapi uvicorn
uvicorn examples.paid_api:app --reload
curl -i localhost:8000/research      # -> 402 Payment Required + requirements
```

## Package layout

```text
settlekit/
  client.py          SettleKit + AsyncSettleKit clients (envelope-aware)
  _transport.py      httpx transport + retries
  errors.py          SettleKitError and subtypes
  verify.py          license / api-key / entitlement verification helpers
  x402.py            FastAPI/Starlette require_payment middleware + 402 flow
  resources/         products, prices, customers, checkout, payments,
                     entitlements, license_keys, api_keys, coupons, invoices,
                     refunds, payouts, agent_services, marketplace
examples/paid_api.py runnable x402-guarded FastAPI app
```
