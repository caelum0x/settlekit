package settlekit

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// CreateWebhookEndpointInput is the body for CreateWebhookEndpoint
// (POST /v1/webhooks/endpoints).
type CreateWebhookEndpointInput struct {
	OrganizationID string   `json:"organizationId"`
	URL            string   `json:"url"`
	EnabledEvents  []string `json:"enabledEvents"`
}

// CreateWebhookEndpoint registers a webhook delivery target and returns its
// signing secret (used to verify delivered event signatures, see
// VerifySignature). POST /v1/webhooks/endpoints.
func (c *Client) CreateWebhookEndpoint(ctx context.Context, in CreateWebhookEndpointInput) (*WebhookEndpoint, error) {
	var out WebhookEndpoint
	if err := c.do(ctx, http.MethodPost, "/v1/webhooks/endpoints", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// EmitEventInput is the body for EmitEvent (POST /v1/webhooks/events).
type EmitEventInput struct {
	OrganizationID string         `json:"organizationId"`
	Type           string         `json:"type"`
	Data           map[string]any `json:"data"`
}

// EmitEvent emits a webhook event to the organization's matching endpoints.
// Deliveries are signed with the endpoint's signing secret via the
// SettleKit-Signature header (see VerifySignature). POST /v1/webhooks/events.
func (c *Client) EmitEvent(ctx context.Context, in EmitEventInput) (*WebhookEvent, error) {
	var out WebhookEvent
	if err := c.do(ctx, http.MethodPost, "/v1/webhooks/events", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// SignatureHeader is the HTTP header carrying the webhook signature on delivered
// events: "SettleKit-Signature: t=<unix-seconds>,v1=<hex hmac-sha256("<t>.<body>")>".
const SignatureHeader = "SettleKit-Signature"

// DefaultSignatureTolerance is the max age of a signed timestamp accepted by
// VerifySignature (replay protection).
const DefaultSignatureTolerance = 5 * time.Minute

// ComputeSignature returns the Stripe-style "t=<ts>,v1=<hex>" signature for a
// raw webhook body at the given unix-second timestamp, using the endpoint
// signing secret. This is exactly the value SettleKit sends in the
// SettleKit-Signature header.
func ComputeSignature(secret string, body []byte, timestamp int64) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(fmt.Sprintf("%d.%s", timestamp, body)))
	return fmt.Sprintf("t=%d,v1=%s", timestamp, hex.EncodeToString(mac.Sum(nil)))
}

// VerifySignature reports whether the SettleKit-Signature header matches the raw
// body, using DefaultSignatureTolerance for replay protection. Equivalent to
// VerifySignatureWithTolerance(secret, body, header, DefaultSignatureTolerance).
//
//	if !settlekit.VerifySignature(secret, rawBody, r.Header.Get(settlekit.SignatureHeader)) {
//	    http.Error(w, "invalid signature", http.StatusBadRequest)
//	    return
//	}
func VerifySignature(secret string, body []byte, header string) bool {
	return VerifySignatureWithTolerance(secret, body, header, DefaultSignatureTolerance)
}

// VerifySignatureWithTolerance verifies the SettleKit-Signature header against
// the raw body in constant time. The header carries "t=<ts>,v1=<hex>"; the HMAC
// input is "<t>.<body>". When tolerance > 0 the signed timestamp must be within
// it of now (pass 0 to skip the replay check). A missing/malformed header, a
// stale timestamp, or any mismatch returns false.
func VerifySignatureWithTolerance(secret string, body []byte, header string, tolerance time.Duration) bool {
	var t, v1 string
	for _, segment := range strings.Split(header, ",") {
		key, value, found := strings.Cut(strings.TrimSpace(segment), "=")
		if !found {
			continue
		}
		switch key {
		case "t":
			t = value
		case "v1":
			v1 = value
		}
	}
	if t == "" || v1 == "" {
		return false
	}

	if tolerance > 0 {
		ts, err := strconv.ParseInt(t, 10, 64)
		if err != nil {
			return false
		}
		age := time.Since(time.Unix(ts, 0))
		if age < 0 {
			age = -age
		}
		if age > tolerance {
			return false
		}
	}

	provided, err := hex.DecodeString(v1)
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(fmt.Sprintf("%s.%s", t, body)))
	return hmac.Equal(provided, mac.Sum(nil))
}
