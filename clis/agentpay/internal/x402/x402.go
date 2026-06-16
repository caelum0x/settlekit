// Package x402 implements the client side of the SettleKit "HTTP 402
// pay-per-call" protocol.
//
// Flow:
//  1. The agent calls a protected endpoint.
//  2. The server replies 402 Payment Required, advertising PaymentRequirements
//     in the JSON body ({error:"payment_required", accepts:[...]}) and in the
//     X-Payment-Required / Accept-Payment headers.
//  3. The agent settles USDC on-chain (out of band — that is the wallet's job)
//     and obtains a transaction hash.
//  4. The agent retries the same request with an X-Payment header carrying a
//     base64-encoded JSON PaymentProof ({txHash, from, amount, network, nonce}).
//  5. The server verifies the transfer on-chain and returns the real response.
//
// This package fully implements encoding/decoding of both the requirements and
// the proof, plus the call/challenge/retry loop.
package x402

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

// Protocol constants — these mirror the SettleKit @settlekit/x402 server package
// exactly so the CLI interoperates with live endpoints.
const (
	// SchemeX402 is the payment scheme advertised in the requirements document.
	SchemeX402 = "x402"
	// HTTPPaymentRequired is the status used to challenge an unpaid request.
	HTTPPaymentRequired = http.StatusPaymentRequired // 402
	// HeaderPayment carries the proof-of-payment on a retried request (base64 JSON).
	HeaderPayment = "X-Payment"
	// HeaderPaymentRequired carries the advertised requirements on a 402 response (JSON).
	HeaderPaymentRequired = "X-Payment-Required"
	// HeaderAcceptPayment is a companion header kept for client interop.
	HeaderAcceptPayment = "Accept-Payment"
	// AssetUSDC is the only settlement asset x402 supports in SettleKit.
	AssetUSDC = "USDC"
)

// PaymentRequirements is the machine-readable payment challenge advertised on a
// 402 response.
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

// PaymentProof is the proof-of-payment the client echoes back in the X-Payment
// header to claim a paid response.
type PaymentProof struct {
	TxHash  string `json:"txHash"`
	From    string `json:"from"`
	Amount  string `json:"amount"`
	Network string `json:"network"`
	Nonce   string `json:"nonce"`
}

// challengeBody is the 402 response body shape:
//
//	{"error":"payment_required","accepts":[PaymentRequirements],"reason"?:string}
type challengeBody struct {
	Error   string                `json:"error"`
	Accepts []PaymentRequirements `json:"accepts"`
	Reason  string                `json:"reason,omitempty"`
}

// EncodeProof serializes a PaymentProof into the base64-JSON value used for the
// X-Payment header.
func EncodeProof(proof PaymentProof) (string, error) {
	encoded, err := json.Marshal(proof)
	if err != nil {
		return "", fmt.Errorf("marshal payment proof: %w", err)
	}
	return base64.StdEncoding.EncodeToString(encoded), nil
}

// DecodeProof parses a base64-JSON X-Payment header value back into a
// PaymentProof. It is the inverse of EncodeProof and validates required fields.
func DecodeProof(header string) (PaymentProof, error) {
	var proof PaymentProof
	if header == "" {
		return proof, errors.New("empty X-Payment header")
	}
	raw, err := base64.StdEncoding.DecodeString(header)
	if err != nil {
		return proof, fmt.Errorf("decode X-Payment base64: %w", err)
	}
	if err := json.Unmarshal(raw, &proof); err != nil {
		return proof, fmt.Errorf("decode X-Payment json: %w", err)
	}
	if err := validateProof(proof); err != nil {
		return proof, err
	}
	return proof, nil
}

func validateProof(p PaymentProof) error {
	switch {
	case p.TxHash == "":
		return errors.New("payment proof: txHash is required")
	case p.From == "":
		return errors.New("payment proof: from is required")
	case p.Amount == "":
		return errors.New("payment proof: amount is required")
	case p.Network == "":
		return errors.New("payment proof: network is invalid")
	case p.Nonce == "":
		return errors.New("payment proof: nonce is required")
	}
	return nil
}

// ParseRequirements extracts PaymentRequirements from a 402 response. It first
// trusts the X-Payment-Required (or Accept-Payment) header and falls back to the
// first entry of the JSON body's accepts array. The raw body is returned so
// callers can surface a server-provided reason.
func ParseRequirements(resp *http.Response, body []byte) (PaymentRequirements, error) {
	if header := firstNonEmpty(resp.Header.Get(HeaderPaymentRequired), resp.Header.Get(HeaderAcceptPayment)); header != "" {
		var req PaymentRequirements
		if err := json.Unmarshal([]byte(header), &req); err == nil && req.Scheme != "" {
			return req, nil
		}
	}

	var challenge challengeBody
	if err := json.Unmarshal(body, &challenge); err != nil {
		return PaymentRequirements{}, fmt.Errorf("parse 402 challenge body: %w", err)
	}
	if len(challenge.Accepts) == 0 {
		return PaymentRequirements{}, errors.New("402 response advertised no payment requirements")
	}
	return challenge.Accepts[0], nil
}

// Response captures the outcome of a paid-endpoint call.
type Response struct {
	// StatusCode is the final HTTP status (200/4xx after retry, or 402 when
	// unpaid and no proof was supplied).
	StatusCode int
	// Body is the raw final response body.
	Body []byte
	// ContentType echoes the response Content-Type for pretty printing.
	ContentType string
	// PaymentRequired is true when the call was challenged with a 402.
	PaymentRequired bool
	// Requirements is populated when PaymentRequired is true.
	Requirements PaymentRequirements
	// Paid is true when a proof was supplied and the retry succeeded (non-402).
	Paid bool
}

// Client drives the x402 call/challenge/retry loop over an *http.Client.
type Client struct {
	HTTP *http.Client
}

// NewClient builds an x402 Client. A nil http client falls back to
// http.DefaultClient.
func NewClient(h *http.Client) *Client {
	if h == nil {
		h = http.DefaultClient
	}
	return &Client{HTTP: h}
}

// CallOptions configures a single paid call.
type CallOptions struct {
	// Method defaults to GET when empty.
	Method string
	// URL is the protected resource to call.
	URL string
	// Body is an optional request body (e.g. JSON input for the service).
	Body []byte
	// ContentType for the request body; defaults to application/json when Body
	// is non-empty and this is empty.
	ContentType string
	// Headers are extra request headers (e.g. Authorization) applied to both
	// the initial call and the paid retry.
	Headers map[string]string
	// Proof, when non-nil, is base64-encoded into the X-Payment header so a 402
	// challenge is paid in a single round-trip. When nil, a 402 is returned to
	// the caller without retrying.
	Proof *PaymentProof
}

// Call executes the x402 flow.
//
//   - With Proof == nil: performs the request once. If the server challenges
//     with 402 the returned Response has PaymentRequired=true and the parsed
//     Requirements, so the caller can display how to pay.
//   - With Proof != nil: attaches the X-Payment header up front. If the server
//     still answers 402 (e.g. verification failed), the Response reports the
//     fresh requirements and Paid=false.
func (c *Client) Call(ctx context.Context, opts CallOptions) (*Response, error) {
	if opts.URL == "" {
		return nil, errors.New("x402 call: URL is required")
	}

	var paymentHeader string
	if opts.Proof != nil {
		encoded, err := EncodeProof(*opts.Proof)
		if err != nil {
			return nil, err
		}
		paymentHeader = encoded
	}

	resp, body, err := c.send(ctx, opts, paymentHeader)
	if err != nil {
		return nil, err
	}

	out := &Response{
		StatusCode:  resp.StatusCode,
		Body:        body,
		ContentType: resp.Header.Get("Content-Type"),
	}

	if resp.StatusCode == HTTPPaymentRequired {
		req, parseErr := ParseRequirements(resp, body)
		if parseErr != nil {
			return nil, parseErr
		}
		out.PaymentRequired = true
		out.Requirements = req
		out.Paid = false
		return out, nil
	}

	// A non-402 status after attaching a proof means the payment was accepted.
	out.Paid = opts.Proof != nil
	return out, nil
}

func (c *Client) send(ctx context.Context, opts CallOptions, paymentHeader string) (*http.Response, []byte, error) {
	method := opts.Method
	if method == "" {
		method = http.MethodGet
	}

	var reader io.Reader
	if len(opts.Body) > 0 {
		reader = bytes.NewReader(opts.Body)
	}

	req, err := http.NewRequestWithContext(ctx, method, opts.URL, reader)
	if err != nil {
		return nil, nil, fmt.Errorf("build %s %s: %w", method, opts.URL, err)
	}

	req.Header.Set("Accept", "application/json")
	if len(opts.Body) > 0 {
		ct := opts.ContentType
		if ct == "" {
			ct = "application/json"
		}
		req.Header.Set("Content-Type", ct)
	}
	for k, v := range opts.Headers {
		req.Header.Set(k, v)
	}
	if paymentHeader != "" {
		req.Header.Set(HeaderPayment, paymentHeader)
	}

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("%s %s: %w", method, opts.URL, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, fmt.Errorf("read response body: %w", err)
	}
	return resp, body, nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
