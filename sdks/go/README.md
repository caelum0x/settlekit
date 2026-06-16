# settlekit-go

The official Go SDK for the [SettleKit](https://settlekit.dev) REST API.

- **Standard library only** — depends solely on `net/http`, `encoding/json`,
  `context`, `time`, `errors`, `crypto/rand`, etc. No third-party modules, so it
  builds offline with zero external dependencies.
- **Typed envelope handling** — every success response is the
  `{ "data": ... }` envelope; every failure is `{ "error": { code, message,
  details? } }` with the HTTP status carrying the error. The SDK decodes both
  and returns a typed `*APIError` on non-2xx.
- **Idempotent writes** — every mutating request (`POST`/`PUT`/`PATCH`/`DELETE`)
  automatically carries a random `Idempotency-Key` header derived from
  `crypto/rand`.

## Installation

```bash
go get github.com/settlekit/settlekit-go
```

Module path: `github.com/settlekit/settlekit-go` (Go 1.24+).

## Authentication

Requests are authenticated with a Bearer API key
(`Authorization: Bearer <apiKey>`). The public auth endpoints under `/v1/auth`
(register, login, magic links) do not require an API key. Session-scoped auth
calls (`Session`, `Logout`) take an explicit session token argument that is sent
as the Bearer token for that request.

## Configuration

```go
c := settlekit.New(
    "sk_live_xxx",
    settlekit.WithBaseURL("https://api.settlekit.dev"), // default: http://localhost:8787
    settlekit.WithHTTPClient(&http.Client{Timeout: 10 * time.Second}),
)
```

## Error handling

```go
product, err := c.GetProduct(ctx, "prod_missing")
if err != nil {
    var apiErr *settlekit.APIError
    if errors.As(err, &apiErr) {
        log.Printf("API error: status=%d code=%s message=%s",
            apiErr.Status, apiErr.Code, apiErr.Message)
    }
    return err
}
```

## Runnable example

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	settlekit "github.com/settlekit/settlekit-go"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	client := settlekit.New(
		"sk_live_your_api_key",
		settlekit.WithBaseURL("http://localhost:8787"),
	)

	// 1. Create a product.
	product, err := client.CreateProduct(ctx, settlekit.CreateProductInput{
		MerchantID:     "merchant_123",
		OrganizationID: "org_123",
		Name:           "Pro Plan",
		Description:    "Everything in Pro",
		Type:           "saas_plan",
		DeliveryMode:   "saas_entitlement",
	})
	if err != nil {
		log.Fatalf("create product: %v", err)
	}
	fmt.Printf("product: %s (%s)\n", product.ID, product.Status)

	// 2. Attach a monthly price.
	price, err := client.CreatePrice(ctx, product.ID, settlekit.CreatePriceInput{
		Amount:   "25.00",
		Currency: "USDC",
		Interval: "monthly",
	})
	if err != nil {
		log.Fatalf("create price: %v", err)
	}

	// 3. Publish the product (requires an active price).
	if _, err := client.PublishProduct(ctx, product.ID); err != nil {
		log.Fatalf("publish product: %v", err)
	}

	// 4. Create a customer.
	customer, err := client.CreateCustomer(ctx, settlekit.CreateCustomerInput{
		OrganizationID: "org_123",
		Email:          "buyer@example.com",
		WalletAddress:  "0xabc...",
	})
	if err != nil {
		log.Fatalf("create customer: %v", err)
	}

	// 5. Open a checkout session.
	session, err := client.CreateCheckoutSession(ctx, settlekit.CreateCheckoutSessionInput{
		OrganizationID: "org_123",
		MerchantID:     "merchant_123",
		CustomerID:     customer.ID,
		Items: []settlekit.CheckoutLineItemInput{
			{PriceID: price.ID, ProductID: product.ID, Quantity: 1},
		},
		PayToAddress: "0xmerchant...",
		Network:      "base",
	})
	if err != nil {
		log.Fatalf("create checkout session: %v", err)
	}
	fmt.Printf("checkout: %s total=%s %s\n",
		session.ID, session.Amount.Amount, session.Amount.Currency)

	// 6. Record and confirm a payment; entitlements are granted on confirm.
	payment, err := client.RecordPayment(ctx, settlekit.RecordPaymentInput{
		CheckoutSessionID: session.ID,
	})
	if err != nil {
		log.Fatalf("record payment: %v", err)
	}

	confirmed, err := client.ConfirmPayment(ctx, payment.ID, settlekit.ConfirmPaymentInput{
		TxHash:        "0xdeadbeef",
		Confirmations: 12,
	})
	if err != nil {
		log.Fatalf("confirm payment: %v", err)
	}
	fmt.Printf("payment %s confirmed; %d entitlement(s) granted\n",
		confirmed.Payment.ID, len(confirmed.Entitlements))

	// 7. Verify access on the hot path.
	verdict, err := client.VerifyEntitlement(ctx, settlekit.VerifyEntitlementInput{
		CustomerID: customer.ID,
		ProductID:  product.ID,
	})
	if err != nil {
		var apiErr *settlekit.APIError
		if errors.As(err, &apiErr) {
			log.Fatalf("verify failed: %s (%s)", apiErr.Message, apiErr.Code)
		}
		log.Fatalf("verify: %v", err)
	}
	fmt.Printf("access granted: %t\n", verdict.Granted)
}
```

## Supported resources

| File              | Methods (selected)                                                                 |
| ----------------- | ---------------------------------------------------------------------------------- |
| `products.go`     | `CreateProduct`, `ListProducts`, `GetProduct`, `PublishProduct`, `CreatePrice`, `ListPrices`, `CreateCustomer`, `ListCustomers`, `GetCustomer`, `CreateBundle`, `ListBundles`, `GetBundle`, `UpdateBundle`, `PublishBundle` |
| `checkout.go`     | `CreateCheckoutSession`, `GetCheckoutSession`, `CollectCheckoutFields`, `CancelCheckoutSession`, `ExpireCheckoutSession` |
| `payments.go`     | `RecordPayment`, `GetPayment`, `ConfirmPayment`, `FailPayment`, `RefundPayment`, `CreateRefund`, `ListRefunds`, `SucceedRefund`, `FailRefund`, `CreatePayout`, `ListPayouts`, `PayoutBalance`, `MarkPayoutPaid`, `FailPayout` |
| `entitlements.go` | `ListEntitlements`, `GetEntitlement`, `VerifyEntitlement`, `SpendCredits`, `RevokeEntitlement` |
| `licensekeys.go`  | `IssueLicenseKey`, `VerifyLicenseKey`, `IssueLicenseToken`, `RevokeLicenseKey`      |
| `apikeys.go`      | `IssueApiKey`, `VerifyApiKey`, `RevokeApiKey`                                       |
| `coupons.go`      | `CreateCoupon`, `ListCoupons`, `GetCoupon`, `ValidateCoupon`, `RedeemCoupon`        |
| `invoices.go`     | `CreateInvoice`, `ListInvoices`, `GetInvoice`, `FinalizeInvoice`, `PayInvoice`, `VoidInvoice` |
| `auth.go`         | `Register`, `Login`, `RequestMagicLink`, `CompleteMagicLink`, `Session`, `Logout`  |
| `marketplace.go`  | `CreateListing`, `ListListings`, `GetListing`, `PublishListing`, `RateListing`, `SellerProfile` |
| `agentservices.go`| `CreateAgentService`, `ListAgentServices`, `PublishAgentService`, `AgentServiceMetadata` |
| `usage.go`        | `RecordUsage`, `GetCredits`, `GrantCredits`, `ConsumeCredits`                       |
| `subscriptions.go`| `CreateSubscription`, `ListSubscriptions`                                           |
| `payouts.go`      | Payout status constants — payout methods (`CreatePayout`, `ListPayouts`, `MarkPayoutPaid`, `PayoutBalance`, `FailPayout`) live in `payments.go` |
| `webhooks.go`     | `CreateWebhookEndpoint`, `EmitEvent`, `ComputeSignature`, `VerifySignature`         |

## Marketplace, agent services, usage & subscriptions

```go
// Publish a marketplace listing and discover it.
listing, _ := c.CreateListing(ctx, settlekit.CreateListingInput{
    OrganizationID: "org_123", MerchantID: "merchant_123", ProductID: product.ID,
    Title: "Pro Plan", Tags: []string{"saas", "api"},
})
c.PublishListing(ctx, listing.ID)
top, _ := c.ListListings(ctx, settlekit.ListListingsOptions{Query: "pro", Tag: "saas", Sort: "top"})
profile, _ := c.SellerProfile(ctx, "merchant_123")

// Register a paid agent service and read its metadata.json.
svc, _ := c.CreateAgentService(ctx, settlekit.CreateAgentServiceInput{
    OrganizationID: "org_123", MerchantID: "merchant_123",
    Name: "summarize", Endpoint: "https://agents.example.com/summarize",
    Amount: "0.01", Currency: "USDC", Network: "base",
})
c.PublishAgentService(ctx, svc.ID)
meta, _ := c.AgentServiceMetadata(ctx, svc.ID)

// Metered usage and prepaid credits.
c.RecordUsage(ctx, settlekit.RecordUsageInput{
    OrganizationID: "org_123", CustomerID: customer.ID, ProductID: product.ID,
    Metric: "api_calls", Quantity: 5,
})
c.GrantCredits(ctx, "org_123", 1000)
balance, _ := c.GetCredits(ctx, "org_123")
c.ConsumeCredits(ctx, "org_123", 10)

// Recurring subscriptions.
sub, _ := c.CreateSubscription(ctx, settlekit.CreateSubscriptionInput{
    OrganizationID: "org_123", CustomerID: customer.ID,
    ProductID: product.ID, PriceID: price.ID,
})
subs, _ := c.ListSubscriptions(ctx, customer.ID)
```

## Webhooks

Register an endpoint, emit events, and verify delivered-event signatures. Each
delivery carries an `X-SettleKit-Signature: v1=<hex>` header, where the hex is
the HMAC-SHA256 of the **raw request body** keyed by the endpoint's signing
secret:

```go
ep, _ := c.CreateWebhookEndpoint(ctx, settlekit.CreateWebhookEndpointInput{
    OrganizationID: "org_123",
    URL:            "https://example.com/webhooks/settlekit",
    EnabledEvents:  []string{"payment.confirmed", "subscription.created"},
})
secret := ep.SigningSecret // returned once at creation — store it securely

c.EmitEvent(ctx, settlekit.EmitEventInput{
    OrganizationID: "org_123",
    Type:           "payment.confirmed",
    Data:           map[string]any{"paymentId": "pay_123"},
})

// In your HTTP handler, verify before trusting the payload:
func handler(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    if !settlekit.VerifySignature(secret, body, r.Header.Get(settlekit.SignatureHeader)) {
        http.Error(w, "invalid signature", http.StatusUnauthorized)
        return
    }
    var event settlekit.WebhookEvent
    json.Unmarshal(body, &event)
    // ... handle event.Type
}
```

`VerifySignature` compares in constant time (`hmac.Equal`) and returns `false`
for missing, malformed, or mismatched signatures. `ComputeSignature` produces
the same `v1=<hex>` value the server sends, for testing or re-signing.

## Money

All monetary values use the `Money` type — a decimal-string `Amount` plus a
`Currency` (`"USDC"`). SettleKit never uses floating point for money, so amounts
are passed and returned as decimal strings such as `"25.50"`.

## License

MIT
