package settlekit

import (
	"context"
	"net/http"
)

// Public authentication endpoints live under /v1/auth and do NOT require an API
// key. The Authorization header sent by the client (the configured API key) is
// ignored by these routes; the session-scoped methods (Session, Logout) take an
// explicit session token argument instead.

// RegisterInput is the body for Register (POST /v1/auth/register). Type is
// "merchant" or "customer".
type RegisterInput struct {
	Email          string `json:"email"`
	Password       string `json:"password"`
	Type           string `json:"type"`
	OrganizationID string `json:"organizationId,omitempty"`
	DisplayName    string `json:"displayName,omitempty"`
}

// AuthResult is the response from Register / Login: the account plus an opaque
// session token to present as a Bearer token on session-scoped calls.
type AuthResult struct {
	Account      Account `json:"account"`
	SessionToken string  `json:"sessionToken"`
}

// Register creates a password account and opens a session.
// POST /v1/auth/register.
func (c *Client) Register(ctx context.Context, in RegisterInput) (*AuthResult, error) {
	var out AuthResult
	if err := c.do(ctx, http.MethodPost, "/v1/auth/register", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// LoginInput is the body for Login (POST /v1/auth/login).
type LoginInput struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// Login verifies credentials and opens a session. POST /v1/auth/login.
func (c *Client) Login(ctx context.Context, in LoginInput) (*AuthResult, error) {
	var out AuthResult
	if err := c.do(ctx, http.MethodPost, "/v1/auth/login", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// RequestMagicLinkResult is the response from RequestMagicLink. DevToken is
// returned only when no email transport is configured (so the flow stays
// testable); otherwise the token is delivered by email and DevToken is empty.
type RequestMagicLinkResult struct {
	OK       bool   `json:"ok"`
	DevToken string `json:"devToken,omitempty"`
}

// RequestMagicLink issues a single-use passwordless sign-in token for an email.
// POST /v1/auth/magic-link/request.
func (c *Client) RequestMagicLink(ctx context.Context, email string) (*RequestMagicLinkResult, error) {
	body := map[string]any{"email": email}
	var out RequestMagicLinkResult
	if err := c.do(ctx, http.MethodPost, "/v1/auth/magic-link/request", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// CompleteMagicLink consumes a magic-link token and opens a session.
// POST /v1/auth/magic-link/complete.
func (c *Client) CompleteMagicLink(ctx context.Context, token string) (*AuthResult, error) {
	body := map[string]any{"token": token}
	var out AuthResult
	if err := c.do(ctx, http.MethodPost, "/v1/auth/magic-link/complete", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Session resolves the account for a session token. The token is sent as the
// Bearer Authorization header, overriding the client's API key for this call.
// GET /v1/auth/session.
func (c *Client) Session(ctx context.Context, sessionToken string) (*Account, error) {
	var out struct {
		Account Account `json:"account"`
	}
	if err := c.doWithToken(ctx, http.MethodGet, "/v1/auth/session", sessionToken, nil, &out); err != nil {
		return nil, err
	}
	return &out.Account, nil
}

// Logout revokes a session token (idempotent). The token is sent as the Bearer
// Authorization header. POST /v1/auth/logout.
func (c *Client) Logout(ctx context.Context, sessionToken string) error {
	return c.doWithToken(ctx, http.MethodPost, "/v1/auth/logout", sessionToken, nil, nil)
}
