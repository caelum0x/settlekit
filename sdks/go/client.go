// Package settlekit is the official Go SDK for the SettleKit REST API.
//
// It targets the SettleKit API (apps/api): Bearer-token auth via the
// "Authorization: Bearer <apiKey>" header, a JSON success envelope of the form
// { "data": ... }, and a failure envelope of the form
// { "error": { "code", "message", "details"? } } where the HTTP status carries
// the error. Public auth endpoints under /v1/auth do not require an API key.
//
// The SDK depends only on the Go standard library, so it builds offline with
// zero external dependencies.
//
// Basic usage:
//
//	c := settlekit.New("sk_live_...", settlekit.WithBaseURL("https://api.settlekit.dev"))
//	product, err := c.CreateProduct(ctx, settlekit.CreateProductInput{ ... })
package settlekit

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// query accumulates optional query-string parameters, skipping empty values,
// and encodes them into a "?k=v&..." suffix (or "" when none were set).
type query struct {
	values url.Values
}

func newQuery() *query { return &query{values: url.Values{}} }

func (q *query) add(key, value string) {
	if value != "" {
		q.values.Set(key, value)
	}
}

func (q *query) encode() string {
	if len(q.values) == 0 {
		return ""
	}
	return "?" + q.values.Encode()
}

// DefaultBaseURL is the API base URL used when WithBaseURL is not supplied.
const DefaultBaseURL = "http://localhost:8787"

// Client is a SettleKit API client. Construct one with New. A Client is safe
// for concurrent use by multiple goroutines.
type Client struct {
	apiKey     string
	baseURL    string
	httpClient *http.Client
}

// Option configures a Client during construction.
type Option func(*Client)

// WithBaseURL overrides the API base URL (default http://localhost:8787).
// A trailing slash, if present, is trimmed.
func WithBaseURL(baseURL string) Option {
	return func(c *Client) {
		c.baseURL = strings.TrimRight(baseURL, "/")
	}
}

// WithHTTPClient sets a custom *http.Client (for timeouts, transports, proxies,
// or testing). A nil client is ignored.
func WithHTTPClient(hc *http.Client) Option {
	return func(c *Client) {
		if hc != nil {
			c.httpClient = hc
		}
	}
}

// New constructs a Client. The apiKey is sent as a Bearer token on every
// request except the public /v1/auth endpoints (which ignore it).
func New(apiKey string, opts ...Option) *Client {
	c := &Client{
		apiKey:     apiKey,
		baseURL:    DefaultBaseURL,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// dataEnvelope is the success wrapper: { "data": <payload> }.
type dataEnvelope struct {
	Data json.RawMessage `json:"data"`
}

// errorEnvelope is the failure wrapper: { "error": { code, message, details? } }.
type errorEnvelope struct {
	Error *APIError `json:"error"`
}

// isWriteMethod reports whether an HTTP method mutates state and therefore
// warrants an Idempotency-Key header.
func isWriteMethod(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

// newIdempotencyKey returns a random 32-hex-character idempotency key derived
// from crypto/rand.
func newIdempotencyKey() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("settlekit: generate idempotency key: %w", err)
	}
	return hex.EncodeToString(buf), nil
}

// do performs an authenticated request using the client's configured API key.
// It marshals body (when non-nil) as JSON, sets the Authorization and
// Content-Type headers, attaches a fresh Idempotency-Key on writes, decodes the
// { "data" } envelope into out (when non-nil), and returns a typed *APIError on
// any non-2xx response.
func (c *Client) do(ctx context.Context, method, path string, body any, out any) error {
	return c.doWithToken(ctx, method, path, c.apiKey, body, out)
}

// doWithToken is like do but sends an explicit Bearer token instead of the
// client's API key. It is used by the public /v1/auth session-scoped endpoints,
// which authenticate with an opaque session token rather than an API key.
func (c *Client) doWithToken(ctx context.Context, method, path, bearer string, body any, out any) error {
	var reqBody io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("settlekit: marshal request body: %w", err)
		}
		reqBody = bytes.NewReader(encoded)
	}

	url := c.baseURL + path
	req, err := http.NewRequestWithContext(ctx, method, url, reqBody)
	if err != nil {
		return fmt.Errorf("settlekit: build request: %w", err)
	}

	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if isWriteMethod(method) {
		key, keyErr := newIdempotencyKey()
		if keyErr != nil {
			return keyErr
		}
		req.Header.Set("Idempotency-Key", key)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("settlekit: %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("settlekit: read response body: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return decodeError(resp.StatusCode, respBytes)
	}

	if out == nil {
		return nil
	}

	var env dataEnvelope
	if err := json.Unmarshal(respBytes, &env); err != nil {
		return fmt.Errorf("settlekit: decode response envelope: %w", err)
	}
	if len(env.Data) == 0 {
		return errors.New("settlekit: response missing \"data\" field")
	}
	if err := json.Unmarshal(env.Data, out); err != nil {
		return fmt.Errorf("settlekit: decode response data: %w", err)
	}
	return nil
}

// decodeError maps a non-2xx response into a typed *APIError. When the body
// does not carry the { "error" } envelope, a synthetic APIError is produced
// from the status code so callers always receive a typed error.
func decodeError(status int, body []byte) error {
	var env errorEnvelope
	if err := json.Unmarshal(body, &env); err == nil && env.Error != nil {
		env.Error.Status = status
		return env.Error
	}
	message := strings.TrimSpace(string(body))
	if message == "" {
		message = http.StatusText(status)
	}
	return &APIError{Status: status, Code: "http_error", Message: message}
}
