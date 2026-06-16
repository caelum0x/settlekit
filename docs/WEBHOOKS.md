# SettleKit Webhooks

Webhooks let your server react to SettleKit events in real time — a payment
confirmed, an entitlement granted, a delivery completed, a subscription renewed.
This guide covers registering endpoints, the event payload, and — most
importantly — **verifying signatures** so you can trust the data.

## Register an endpoint

```bash
curl -s -H "Authorization: Bearer $SETTLEKIT_API_KEY" -H "content-type: application/json" \
  -d '{"organizationId":"org_1","url":"https://yourapp.com/webhooks/settlekit","enabledEvents":["payment.confirmed","delivery.completed"]}' \
  $SETTLEKIT_API_URL/v1/webhooks/endpoints
```

The response includes a `signingSecret` (shown once) — store it as a secret on
your server. SettleKit signs every delivery to this endpoint with it.

You can also register via any SDK, e.g. TypeScript:

```ts
const endpoint = await sk.webhooks.createEndpoint({
  organizationId: "org_1",
  url: "https://yourapp.com/webhooks/settlekit",
  enabledEvents: ["payment.confirmed"],
});
console.log(endpoint.signingSecret); // store this
```

## The event payload

Each delivery POSTs a JSON event:

```json
{
  "id": "evt_…",
  "type": "payment.confirmed",
  "data": { "paymentId": "pay_…", "amount": { "amount": "25.00", "currency": "USDC" } },
  "createdAt": "2026-06-16T00:00:00.000Z"
}
```

## Verifying the signature (do this!)

Every delivery carries a Stripe-style signature header:

```
SettleKit-Signature: t=<unix-seconds>,v1=<hex hmac-sha256("<t>.<raw body>", signingSecret)>
```

**Always verify against the RAW request body** (the exact bytes you received) —
never re-serialize the parsed JSON, since key order and whitespace must match.
SettleKit's SDKs ship a constant-time verifier with replay protection (a default
5-minute tolerance on `t`).

### TypeScript / Node

```ts
import { verifyWebhookSignature } from "@settlekit/sdk";
import express from "express";

const app = express();
// Capture the RAW body for this route.
app.post("/webhooks/settlekit", express.raw({ type: "application/json" }), (req, res) => {
  const raw = req.body.toString("utf8");
  const sig = req.header("SettleKit-Signature") ?? "";
  if (!verifyWebhookSignature(process.env.WEBHOOK_SECRET!, raw, sig)) {
    return res.status(400).send("invalid signature");
  }
  const event = JSON.parse(raw);
  // … handle event.type …
  res.json({ received: true });
});
```

### Python

```python
from settlekit import verify_webhook_signature
from fastapi import FastAPI, Request, Response

app = FastAPI()

@app.post("/webhooks/settlekit")
async def webhook(request: Request):
    raw = (await request.body()).decode("utf-8")
    sig = request.headers.get("settlekit-signature", "")
    if not verify_webhook_signature(os.environ["WEBHOOK_SECRET"], raw, sig):
        return Response(status_code=400, content="invalid signature")
    event = json.loads(raw)
    # … handle event["type"] …
    return {"received": True}
```

### Go

```go
import settlekit "github.com/settlekit/settlekit-go"

func handler(w http.ResponseWriter, r *http.Request) {
    raw, _ := io.ReadAll(r.Body)
    sig := r.Header.Get(settlekit.SignatureHeader) // "SettleKit-Signature"
    if !settlekit.VerifySignature(os.Getenv("WEBHOOK_SECRET"), raw, sig) {
        http.Error(w, "invalid signature", http.StatusBadRequest)
        return
    }
    // … decode + handle the event …
    w.WriteHeader(http.StatusOK)
}
```

## Retries & at-least-once delivery

SettleKit (and the optional `services/webhook-relay`) retry failed deliveries
with exponential backoff. Treat handlers as **idempotent** — key on `event.id`
and ignore an event you've already processed. Return a `2xx` quickly (do heavy
work asynchronously); non-2xx responses are retried until the schedule is
exhausted.

## Tips

- Respond fast (`2xx`) and process out-of-band; SettleKit times out slow handlers.
- Verify **before** parsing untrusted JSON.
- Rotate the signing secret by registering a new endpoint and retiring the old.
- In dev, emit a test event: `POST /v1/webhooks/events {organizationId,type,data}`
  returns the signed deliveries so you can replay them locally.

See [API.md](./API.md) for the full webhook endpoint reference.
