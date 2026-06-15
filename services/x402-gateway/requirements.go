package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
)

// Protocol constants, mirroring packages/x402/src/types.ts so this gateway is
// wire-compatible with SettleKit's TypeScript x402 middleware and clients.
const (
	// X402Scheme is the payment scheme advertised in the requirements document.
	X402Scheme = "x402"

	// HTTPPaymentRequired is the HTTP status used to challenge an unpaid request.
	HTTPPaymentRequired = 402

	// PaymentHeader carries the proof-of-payment on a retried request (base64 JSON).
	PaymentHeader = "X-Payment"
	// PaymentRequiredHeader carries the advertised requirements on a 402 (JSON).
	PaymentRequiredHeader = "X-Payment-Required"
	// AcceptPaymentHeader is the companion header name, kept for client interop.
	AcceptPaymentHeader = "Accept-Payment"
)

// PaymentRequirements is the machine-readable description advertised on a 402
// response, serialized as JSON into both the body and the payment headers.
// The field set + JSON tags match packages/x402 PaymentRequirements exactly.
type PaymentRequirements struct {
	Scheme    string `json:"scheme"`
	Amount    string `json:"amount"`
	Asset     string `json:"asset"`
	Network   string `json:"network"`
	PayTo     string `json:"payTo"`
	ProductID string `json:"productId"`
	Resource  string `json:"resource"`
	Nonce     string `json:"nonce"`
}

// PaymentRequiredBody is the 402 response envelope, matching the TS middleware:
// `{ error: "payment_required", accepts: [...], reason? }`.
type PaymentRequiredBody struct {
	Error   string                `json:"error"`
	Accepts []PaymentRequirements `json:"accepts"`
	Reason  string                `json:"reason,omitempty"`
}

// buildRequirements constructs the PaymentRequirements for a given resource.
// When the config carries a stable nonce it is used verbatim; otherwise an
// HMAC-derived nonce bound to the resource is generated so a stateless paid
// retry can be verified locally without server-side nonce storage.
func buildRequirements(cfg Config, resource string) PaymentRequirements {
	nonce := cfg.Nonce
	if nonce == "" {
		nonce = deriveNonce(cfg.HMACSecret, resource)
	}
	return PaymentRequirements{
		Scheme:    X402Scheme,
		Amount:    cfg.Price,
		Asset:     cfg.Currency,
		Network:   cfg.Network,
		PayTo:     cfg.PayTo,
		ProductID: cfg.ProductID,
		Resource:  resource,
		Nonce:     nonce,
	}
}

// deriveNonce computes a deterministic, HMAC-signed nonce bound to a resource.
// Because it is reproducible for the same (secret, resource) pair, the gateway
// can verify a paid retry locally by recomputing and constant-time comparing
// the echoed nonce — no per-challenge state required.
func deriveNonce(secret, resource string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("x402-nonce:"))
	mac.Write([]byte(resource))
	sum := mac.Sum(nil)
	return base64.RawURLEncoding.EncodeToString(sum)
}

// nonceMatches reports whether candidate equals the expected nonce for the
// resource, using a constant-time comparison to avoid timing leaks.
func nonceMatches(cfg Config, resource, candidate string) bool {
	var expected string
	if cfg.Nonce != "" {
		expected = cfg.Nonce
	} else {
		expected = deriveNonce(cfg.HMACSecret, resource)
	}
	return hmac.Equal([]byte(expected), []byte(candidate))
}
