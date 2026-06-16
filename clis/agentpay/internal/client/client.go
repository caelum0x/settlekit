// Package client is a thin HTTP client for the SettleKit v1 HTTP API.
//
// It understands the SettleKit response envelope:
//
//	success -> {"data": <T>}
//	error   -> {"error": {"code": string, "message": string}}  (with a non-2xx status)
//
// Auth is a bearer token sourced from SETTLEKIT_API_KEY; the base URL is
// sourced from SETTLEKIT_API_URL (defaulting to http://localhost:8787).
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// DefaultBaseURL is used when SETTLEKIT_API_URL is unset.
const DefaultBaseURL = "http://localhost:8787"

const (
	envBaseURL = "SETTLEKIT_API_URL"
	envAPIKey  = "SETTLEKIT_API_KEY"
)

// APIError is a structured error returned by the SettleKit API. It carries the
// HTTP status alongside the {error:{code,message}} envelope fields.
type APIError struct {
	Status  int
	Code    string
	Message string
}

func (e *APIError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("settlekit api error (%d %s): %s", e.Status, e.Code, e.Message)
	}
	return fmt.Sprintf("settlekit api error (%d): %s", e.Status, e.Message)
}

// Client is a configured SettleKit API client. The zero value is not usable;
// construct it with New.
type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

// Option customizes a Client during construction.
type Option func(*Client)

// WithBaseURL overrides the API base URL.
func WithBaseURL(raw string) Option {
	return func(c *Client) {
		if raw != "" {
			c.baseURL = strings.TrimRight(raw, "/")
		}
	}
}

// WithAPIKey overrides the bearer token.
func WithAPIKey(key string) Option {
	return func(c *Client) { c.apiKey = key }
}

// WithHTTPClient injects a custom *http.Client (timeouts, transport, etc.).
func WithHTTPClient(h *http.Client) Option {
	return func(c *Client) {
		if h != nil {
			c.http = h
		}
	}
}

// New builds a Client. By default it reads SETTLEKIT_API_URL and
// SETTLEKIT_API_KEY from the environment; options override those values.
func New(opts ...Option) *Client {
	c := &Client{
		baseURL: strings.TrimRight(envOr(envBaseURL, DefaultBaseURL), "/"),
		apiKey:  os.Getenv(envAPIKey),
		http:    &http.Client{Timeout: 30 * time.Second},
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// BaseURL returns the configured base URL.
func (c *Client) BaseURL() string { return c.baseURL }

// APIKey returns the configured bearer token (may be empty).
func (c *Client) APIKey() string { return c.apiKey }

// envelope is the SettleKit response wrapper. Exactly one of Data / Error is
// populated depending on success.
type envelope struct {
	Data  json.RawMessage `json:"data"`
	Error *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// Get performs GET <path> (path is joined onto the base URL, query may be nil)
// and decodes the envelope's data field into out.
func (c *Client) Get(ctx context.Context, path string, query url.Values, out any) error {
	full := c.baseURL + path
	if len(query) > 0 {
		full += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, full, nil)
	if err != nil {
		return fmt.Errorf("build GET %s: %w", path, err)
	}
	return c.do(req, out)
}

// Post performs POST <path> with a JSON-encoded body and decodes the
// envelope's data field into out. A nil body sends an empty payload.
func (c *Client) Post(ctx context.Context, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("encode POST %s body: %w", path, err)
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, reader)
	if err != nil {
		return fmt.Errorf("build POST %s: %w", path, err)
	}
	req.Header.Set("Content-Type", "application/json")
	return c.do(req, out)
}

// do executes the request, applies auth, and unwraps the envelope. When the
// response is non-2xx it returns an *APIError. On success it decodes the data
// field into out (out may be nil to discard the payload).
func (c *Client) do(req *http.Request, out any) error {
	c.applyAuth(req)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("%s %s: %w", req.Method, req.URL.Path, err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response body: %w", err)
	}

	var env envelope
	// The body may be empty (e.g. 204) or non-JSON on infrastructure errors;
	// decode best-effort and fall back to raw text in the error path.
	if len(bytes.TrimSpace(raw)) > 0 {
		if decodeErr := json.Unmarshal(raw, &env); decodeErr != nil && resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return fmt.Errorf("decode response envelope (%s %s): %w", req.Method, req.URL.Path, decodeErr)
		}
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		apiErr := &APIError{Status: resp.StatusCode}
		if env.Error != nil {
			apiErr.Code = env.Error.Code
			apiErr.Message = env.Error.Message
		} else {
			apiErr.Message = strings.TrimSpace(string(raw))
			if apiErr.Message == "" {
				apiErr.Message = resp.Status
			}
		}
		return apiErr
	}

	if out == nil {
		return nil
	}
	if len(env.Data) == 0 {
		return errors.New("response envelope missing data field")
	}
	if err := json.Unmarshal(env.Data, out); err != nil {
		return fmt.Errorf("decode response data (%s %s): %w", req.Method, req.URL.Path, err)
	}
	return nil
}

func (c *Client) applyAuth(req *http.Request) {
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
