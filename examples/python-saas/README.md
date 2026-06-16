# AI Export Pro — FastAPI SaaS gated by SettleKit

A complete, **runnable** demo SaaS built with FastAPI. It sells a single paid
feature — an "AI export" — and gates it behind **SettleKit entitlements** with a
**prepaid-credit** fallback, using the real [SettleKit Python SDK](../../sdks/python)
(`import settlekit`) and HTTP API. There is no mock data and no fake gate: every
handler calls SettleKit.

## Access policy

A `POST /ai/export` call is allowed when **either** of these is true:

1. The customer holds the **`ai_export` entitlement** (e.g. an active Pro plan) —
   verified via `verify_entitlement` / `entitlements.verify`. Unlimited, no
   credit spent.
2. The customer has a **prepaid credit** — one credit is atomically consumed via
   the SettleKit usage API. Pay-as-you-go.

Otherwise the request is denied with **402 Payment Required** (out of
credits/entitlement) carrying a friendly upgrade message.

## Layout

```
examples/python-saas/
├── requirements.txt          # fastapi, uvicorn, httpx, editable SDK
├── pyproject.toml            # optional project metadata
├── README.md
└── app/
    ├── __init__.py
    ├── main.py               # FastAPI app + routes + error handlers
    ├── deps.py               # the entitlement/credit gate dependency
    └── settlekit_client.py   # constructs the SDK client + credit helpers
```

## Endpoints

| Method | Path                                   | Purpose                                   |
|--------|----------------------------------------|-------------------------------------------|
| GET    | `/`                                    | Public landing JSON (plan tiers)          |
| GET    | `/healthz`                             | Liveness probe (no SettleKit call)        |
| POST   | `/signup`                              | Create a SettleKit customer               |
| GET    | `/me/entitlements?customer_id=`        | Show entitlement + credit balance         |
| POST   | `/ai/export?customer_id=`              | **PAID** — gated AI export                 |
| POST   | `/billing/grant-credits`               | Admin: grant prepaid credits              |

## Environment variables

| Variable               | Required | Default                  | Description                                          |
|------------------------|----------|--------------------------|------------------------------------------------------|
| `SETTLEKIT_API_KEY`    | yes      | —                        | Bearer key sent on every request (`Authorization`).  |
| `SETTLEKIT_ORG_ID`     | yes      | —                        | Organization id customers/usage are scoped to.       |
| `SETTLEKIT_API_URL`    | no       | `http://localhost:8787`  | SettleKit API base URL.                              |
| `SETTLEKIT_PRODUCT_ID` | no       | `ai_export`              | Product id recorded against metered usage.           |
| `AI_EXPORT_FEATURE`    | no       | `ai_export`              | Entitlement feature key the paid route checks.       |

The app validates required vars at startup and fails fast with a clear message.

## Install & run

> The SDK is installed in editable mode from the monorepo via `requirements.txt`.

```bash
cd examples/python-saas

python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# (equivalently: pip install fastapi "uvicorn[standard]" httpx -e ../../sdks/python)

export SETTLEKIT_API_KEY="sk_live_..."     # your SettleKit API key
export SETTLEKIT_ORG_ID="org_123"          # your organization id
export SETTLEKIT_API_URL="http://localhost:8787"   # optional

uvicorn app.main:app --reload --port 8000
```

Make sure the SettleKit API is running and reachable at `SETTLEKIT_API_URL`, and
that the `ai_export` feature/product exists in your organization (so entitlement
verification and credit grants resolve).

## Full curl walkthrough

### 0) Landing page (public)

```bash
curl -s http://localhost:8000/ | python3 -m json.tool
```

### 1) Sign up — create a customer

```bash
curl -s -X POST http://localhost:8000/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","name":"Ada Lovelace"}' | python3 -m json.tool
```

Copy the returned `customerId` (referred to as `$CID` below):

```bash
CID="cus_...."   # paste the id from the signup response
```

### 2) Check access (should be denied — no entitlement, no credits)

```bash
curl -s "http://localhost:8000/me/entitlements?customer_id=$CID" | python3 -m json.tool
# -> { "entitled": false, "credits": 0, "canExport": false, "accessVia": "none" }
```

### 3) Try the paid export — DENIED (402)

```bash
curl -s -i -X POST "http://localhost:8000/ai/export?customer_id=$CID" \
  -H 'Content-Type: application/json' \
  -d '{"dataset":"q2-sales","fmt":"csv"}'
# -> HTTP/1.1 402 Payment Required
# -> {"error":{"code":"payment_required","message":"AI export is a paid feature...","upgradeUrl":"/#pricing"}}
```

### 4a) Grant prepaid credits (admin) — then export is ALLOWED via credit

```bash
curl -s -X POST http://localhost:8000/billing/grant-credits \
  -H 'Content-Type: application/json' \
  -d "{\"customer_id\":\"$CID\",\"credits\":5}" | python3 -m json.tool

curl -s -X POST "http://localhost:8000/ai/export?customer_id=$CID" \
  -H 'Content-Type: application/json' \
  -d '{"dataset":"q2-sales","fmt":"csv"}' | python3 -m json.tool
# -> { "ok": true, "export": {...}, "access": {"via":"credit","creditsRemaining":4} }
```

Each successful credit-based export consumes one credit. Re-check the balance:

```bash
curl -s "http://localhost:8000/me/entitlements?customer_id=$CID" | python3 -m json.tool
```

### 4b) Alternatively, grant the `ai_export` entitlement — unlimited exports

Grant the entitlement in SettleKit (e.g. by attaching the `ai_export` feature to
the customer through a Pro subscription or directly via the SettleKit dashboard /
API). Once `POST /v1/entitlements/verify` returns `{"allowed": true}` for the
customer, exports succeed **without** spending credits:

```bash
curl -s -X POST "http://localhost:8000/ai/export?customer_id=$CID" \
  -H 'Content-Type: application/json' \
  -d '{"dataset":"q2-sales","fmt":"json"}' | python3 -m json.tool
# -> { "ok": true, "access": {"via":"entitlement","creditsRemaining":null} }
```

## How it works

- **`app/settlekit_client.py`** constructs one process-wide `AsyncSettleKit`
  client from env vars (closed on app shutdown). It also wraps the prepaid-credit
  and metered-usage endpoints (`/v1/usage/credits`, `/v1/usage/credits/grant`,
  `/v1/usage/credits/consume`, `/v1/usage/record`) through the SDK's low-level
  `arequest` method.
- **`app/deps.py`** is the gate: a FastAPI dependency that (1) calls
  `entitlements.verify`, then (2) falls back to atomically consuming a credit.
  Denials raise `GateDenied`; genuine SettleKit/API failures propagate so they
  surface as 5xx rather than being mistaken for a billing decision.
- **`app/main.py`** wires the routes, validates input with Pydantic, records
  usage after a successful export, and maps `GateDenied` / `SettleKitError` to
  clean HTTP responses (402/403 for billing, 502 for upstream outages, 500 for
  misconfiguration).

## Notes

- Money is represented as `{"amount": "25.00", "currency": "USDC"}`, matching the
  SettleKit API convention (see the plan tiers on `GET /`).
- The admin route `POST /billing/grant-credits` is left open for the demo. In
  production, protect it with an admin API key / role check.
