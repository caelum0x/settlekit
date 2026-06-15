package settlekit

import (
	"context"
	"net/http"
)

// IssueApiKeyInput is the body for IssueApiKey (POST /v1/api-keys).
type IssueApiKeyInput struct {
	OrganizationID string   `json:"organizationId"`
	CustomerID     string   `json:"customerId"`
	ProductID      string   `json:"productId"`
	EntitlementID  string   `json:"entitlementId"`
	Scopes         []string `json:"scopes"`
	Env            string   `json:"env,omitempty"`
}

// IssueApiKeyResult is the response from IssueApiKey. Plaintext is the secret
// shown exactly once; persist only the returned ApiKey metadata.
type IssueApiKeyResult struct {
	ApiKey    ApiKey `json:"apiKey"`
	Plaintext string `json:"plaintext"`
}

// IssueApiKey issues a scoped API key, returning its one-time plaintext secret.
// POST /v1/api-keys.
func (c *Client) IssueApiKey(ctx context.Context, in IssueApiKeyInput) (*IssueApiKeyResult, error) {
	var out IssueApiKeyResult
	if err := c.do(ctx, http.MethodPost, "/v1/api-keys", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// VerifyApiKeyInput is the body for VerifyApiKey (POST /v1/api-keys/verify).
type VerifyApiKeyInput struct {
	Key            string   `json:"key"`
	RequiredScopes []string `json:"requiredScopes,omitempty"`
}

// VerifyApiKeyResult is the verify decision; ApiKey is populated when valid.
type VerifyApiKeyResult struct {
	Valid  bool    `json:"valid"`
	ApiKey *ApiKey `json:"apiKey,omitempty"`
}

// VerifyApiKey verifies a presented API key and its required scopes.
// POST /v1/api-keys/verify.
func (c *Client) VerifyApiKey(ctx context.Context, in VerifyApiKeyInput) (*VerifyApiKeyResult, error) {
	var out VerifyApiKeyResult
	if err := c.do(ctx, http.MethodPost, "/v1/api-keys/verify", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// RevokeApiKey revokes an API key by its plaintext. POST /v1/api-keys/revoke.
func (c *Client) RevokeApiKey(ctx context.Context, key string) (*ApiKey, error) {
	body := map[string]any{"key": key}
	var out ApiKey
	if err := c.do(ctx, http.MethodPost, "/v1/api-keys/revoke", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
